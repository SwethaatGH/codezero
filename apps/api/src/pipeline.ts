import { EventEmitter } from "node:events";
import type {
  AnalysisResult,
  CodeFunction,
  Commit,
  Investigation,
  InvestigationProgress,
  PipelineStage,
  ProgressEvent,
  RiskAssessment,
  StageState,
} from "@code-zero/shared";
import {
  assessCommit,
  bisectDemo,
  buildDemoHistory,
  buildDependencyGraph,
  computeHealth,
  fileFanIn,
  isIgnoredForGraph,
  isJsTs,
  isSourcePath,
  parseModule,
  rankSuspects,
  type SourceFile,
} from "@code-zero/analysis";
import { env } from "./config";
import type { DB } from "./db";
import { ApiError } from "./errors";
import { sourceFor, type RepoSource } from "./sources";
import { checkAIStatus } from "./ai/provider";

export const STAGES: { stage: PipelineStage; label: string }[] = [
  { stage: "connect", label: "Connecting to GitHub" },
  { stage: "metadata", label: "Fetching metadata" },
  { stage: "commits", label: "Retrieving commits" },
  { stage: "diffs", label: "Loading diffs" },
  { stage: "parse", label: "Parsing changed files" },
  { stage: "dependencies", label: "Building dependency relationships" },
  { stage: "risk", label: "Calculating risk signals" },
  { stage: "ai-context", label: "Preparing AI context" },
];

export function initialProgress(isDemo: boolean): InvestigationProgress {
  return {
    stages: STAGES.map((s) => ({ ...s, label: isDemo && s.stage === "connect" ? "Loading simulated demo repository" : s.label, status: "pending", detail: null })),
    percent: 0,
    logs: [],
  };
}

export const progressBus = new EventEmitter();
progressBus.setMaxListeners(100);
const running = new Map<string, AbortController>();

export function isRunning(id: string) {
  return running.has(id);
}

export function cancelInvestigation(id: string): boolean {
  const c = running.get(id);
  if (!c) return false;
  c.abort();
  return true;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>, signal: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (signal.aborted) throw new ApiError(499, "CANCELLED", "Analysis cancelled");
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs (or resumes) the full analysis pipeline for an investigation. Resolves when finished; never throws. */
export async function runInvestigation(db: DB, id: string, opts: { demoPacingMs?: number } = {}): Promise<void> {
  const inv0 = db.getInvestigation(id);
  if (!inv0) return;
  if (running.has(id)) return;
  const controller = new AbortController();
  running.set(id, controller);
  const signal = controller.signal;

  const inv: Investigation = { ...inv0, status: "running", error: null, progress: initialProgress(inv0.isDemo), updatedAt: new Date().toISOString() };
  const emit = () => {
    inv.updatedAt = new Date().toISOString();
    db.saveInvestigation(inv);
    const ev: ProgressEvent = { type: "progress", progress: inv.progress, status: inv.status };
    progressBus.emit(id, ev);
  };
  const log = (level: "info" | "warn" | "error", message: string) => {
    inv.progress.logs.push({ at: new Date().toISOString(), level, message });
    if (inv.progress.logs.length > 300) inv.progress.logs.shift();
  };
  const setStage = (stage: PipelineStage, status: StageState["status"], detail: string | null = null) => {
    inv.progress.stages = inv.progress.stages.map((s) => (s.stage === stage ? { ...s, status, detail } : s));
    const done = inv.progress.stages.filter((s) => s.status === "done" || s.status === "skipped").length;
    inv.progress.percent = Math.round((done / STAGES.length) * 100);
    emit();
  };
  const pacing = inv.isDemo ? (opts.demoPacingMs ?? 350) : 0;
  let current: PipelineStage = "connect";
  const stage = async <T>(s: PipelineStage, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> => {
    if (signal.aborted) throw new ApiError(499, "CANCELLED", "Analysis cancelled");
    current = s;
    setStage(s, "running");
    const r = await fn();
    if (pacing) await pause(pacing);
    setStage(s, "done", detail ? detail(r) : null);
    return r;
  };

  emit();
  log("info", `Investigation started (${inv.mode}) on ${inv.repoFullName}@${inv.branch}`);

  try {
    const source: RepoSource = sourceFor(db, inv.repositoryId);
    const p = inv.params;

    await stage("connect", async () => {
      const r = await source.getRepository();
      log("info", source.isDemo ? "Using SIMULATED demo repository (no network)" : `Connected to github.com/${r.fullName}`);
      return r;
    }, () => (source.isDemo ? "Offline demo" : "GitHub API reachable"));

    const repo = await stage("metadata", async () => {
      const r = await source.getRepository();
      db.saveRepository(r);
      return r;
    }, (r) => `${r.primaryLanguage ?? "unknown language"} · default branch ${r.defaultBranch}`);

    // ── Commits ──
    const listed = await stage("commits", async (): Promise<Commit[]> => {
      if (inv.mode === "regression-hunt") {
        const { commits, total } = await source.commitsBetween(p.goodSha!, p.badSha!, p.limit);
        if (total > commits.length) log("warn", `Range contains ${total} commits; analyzing the newest ${commits.length} (limit ${p.limit}).`);
        return commits.reverse();
      }
      if (inv.mode === "single-commit") return [await source.getCommit(p.commitSha!)];
      return source.listCommits({ branch: inv.branch, limit: p.limit, since: p.since, until: p.until });
    }, (r) => `${r.length} commit(s)`);
    if (listed.length === 0) throw new ApiError(422, "NO_COMMITS", "No commits matched the selected branch, range and dates.");
    inv.commitRange = { from: listed[listed.length - 1].sha, to: listed[0].sha, count: listed.length };
    if (inv.mode === "regression-hunt") {
      inv.knownGoodSha = inv.knownGoodSha ?? p.goodSha;
      inv.knownBadSha = inv.knownBadSha ?? listed[0].sha;
    }

    // ── Diffs ──
    let loaded = 0;
    const commits = await stage("diffs", () =>
      mapLimit(listed, 4, async (c) => {
        // Listing endpoints omit file details; fetch the full commit (cached by SHA).
        const full = c.files.length ? c : await source.getCommit(c.sha);
        loaded++;
        if (loaded % 5 === 0 || loaded === listed.length) {
          inv.progress.stages = inv.progress.stages.map((s) => (s.stage === "diffs" ? { ...s, detail: `${loaded}/${listed.length}` } : s));
          emit();
        }
        return full;
      }, signal),
    (r) => `${r.reduce((s, c) => s + c.files.length, 0)} file changes`);
    const truncated = commits.flatMap((c) => c.files.filter((f) => f.truncated).map((f) => `${c.shortSha}:${f.path}`));
    if (truncated.length) log("warn", `${truncated.length} file diff(s) were truncated by GitHub and are only counted, not parsed.`);

    // ── Parse changed JS/TS files at each commit (AST) ──
    const functionsByCommit = new Map<string, Map<string, CodeFunction[]>>();
    await stage("parse", async () => {
      let parsed = 0;
      let failed = 0;
      for (const c of commits) {
        const map = new Map<string, CodeFunction[]>();
        const targets = c.files.filter((f) => isJsTs(f.path) && f.status !== "removed" && !f.binary).slice(0, env.maxParseFilesPerCommit);
        if (c.files.filter((f) => isJsTs(f.path)).length > targets.length) log("warn", `${c.shortSha}: parsed ${targets.length} JS/TS files (limit ${env.maxParseFilesPerCommit}).`);
        await mapLimit(targets, 4, async (f) => {
          try {
            const content = await source.getFile(f.path, c.sha);
            if (content === null) return;
            const pm = parseModule(f.path, content);
            if (pm.parseError) log("warn", `${c.shortSha} ${f.path}: ${pm.parseError}`);
            map.set(f.path, pm.functions);
            parsed++;
          } catch (err) {
            failed++;
            log("warn", `${c.shortSha} ${f.path}: ${(err as Error).message}`);
          }
        }, signal);
        functionsByCommit.set(c.sha, map);
      }
      return { parsed, failed };
    }, (r) => `${r.parsed} file(s) parsed${r.failed ? `, ${r.failed} failed` : ""}`);

    // ── Dependency graph at head ──
    const headSha = commits[0].sha;
    const built = await stage("dependencies", async () => {
      let tree: { paths: string[]; truncated: boolean };
      try {
        tree = await source.getTree(headSha);
      } catch (err) {
        log("warn", `Could not load file tree: ${(err as Error).message}. Dependency graph skipped.`);
        return null;
      }
      if (tree.truncated) log("warn", "GitHub truncated the recursive tree; the graph covers a partial file list.");
      const changed = new Set(commits.flatMap((c) => c.files.map((f) => f.path)));
      const candidates = tree.paths.filter((pth) => isSourcePath(pth) && !isIgnoredForGraph(pth));
      // Prioritize changed files, then JS/TS/Python, then everything else.
      candidates.sort((a, b) => Number(changed.has(b)) - Number(changed.has(a)) || Number(isJsTs(b) || b.endsWith(".py")) - Number(isJsTs(a) || a.endsWith(".py")) || a.localeCompare(b));
      const selected = candidates.slice(0, env.maxGraphFiles);
      const skipped = candidates.slice(env.maxGraphFiles).map((path) => ({ path, reason: `Beyond graph limit of ${env.maxGraphFiles} files` }));
      if (skipped.length) log("warn", `${skipped.length} source file(s) beyond the ${env.maxGraphFiles}-file graph limit were skipped.`);
      const files: SourceFile[] = [];
      await mapLimit(selected, 6, async (path) => {
        if (!(isJsTs(path) || path.endsWith(".py"))) {
          files.push({ path, content: "" }); // node only; no relationships inferred
          return;
        }
        try {
          const content = await source.getFile(path, headSha);
          if (content !== null) files.push({ path, content });
          else skipped.push({ path, reason: "Not readable" });
        } catch (err) {
          skipped.push({ path, reason: (err as Error).message });
        }
      }, signal);
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { ...buildDependencyGraph(files, { headSha, skipped }), treePaths: tree.paths };
    }, (r) => (r ? `${r.graph.nodes.length} nodes · ${r.graph.edges.length} edges` : "Skipped"));

    // ── Risk ──
    const result = await stage("risk", async () => {
      const fanIn = built ? fileFanIn(built.graph) : undefined;
      const assessments: RiskAssessment[] = commits.map((c) => assessCommit(c, { functionsByFile: functionsByCommit.get(c.sha), fanIn, symptoms: p.symptoms }));
      let bisect = null;
      if (source.isDemo) {
        const demo = buildDemoHistory();
        const chrono = [...demo.commits].reverse().filter((c) => commits.some((x) => x.sha === c.sha));
        if (chrono.length >= 1) {
          bisect = bisectDemo(chrono, demo.snapshots, inv.mode === "regression-hunt" ? p.goodSha : null, inv.mode === "regression-hunt" ? p.badSha : null);
          log("info", bisect.firstBadSha ? `Demo verification harness: first failing commit ${bisect.firstBadSha.slice(0, 7)} (${bisect.steps.length} bisect steps).` : "Demo verification harness: no failing commit in range.");
        }
      }
      const findings = inv.mode === "exploration" ? [] : rankSuspects(commits, assessments, { bisect });
      const health = computeHealth(commits, assessments, { languages: repo.languages, treePaths: built?.treePaths ?? null });
      return { assessments, bisect, findings, health };
    }, (r) => `${r.findings.length} candidate(s) · max score ${Math.max(0, ...r.assessments.map((a) => a.score))}`);

    inv.findings = result.findings;
    if (!inv.selectedCommitSha) inv.selectedCommitSha = result.findings[0]?.commitSha ?? commits[0].sha;
    if (source.isDemo && result.bisect?.lastGoodSha && !inv.knownGoodSha) inv.knownGoodSha = result.bisect.lastGoodSha;
    if (source.isDemo && result.bisect?.firstBadSha && !inv.knownBadSha) inv.knownBadSha = result.bisect.firstBadSha;

    const analysis: AnalysisResult = {
      investigationId: id,
      commits,
      assessments: result.assessments,
      graph: built?.graph ?? null,
      health: result.health,
      bisect: result.bisect,
      generatedAt: new Date().toISOString(),
    };
    db.saveAnalysis(analysis);

    await stage("ai-context", async () => {
      const s = await checkAIStatus(db.getSettings(), false);
      log(s.state === "connected" ? "info" : "warn", `Gemma: ${s.message}`);
      return s;
    }, (s) => (s.state === "connected" ? `${s.model} ready` : s.state === "model-missing" ? "Model not installed" : source.isDemo ? "Gemma unavailable — prerecorded demo analysis only" : "Gemma unavailable — deterministic results only"));

    inv.status = "completed";
    log("info", "Investigation complete.");
  } catch (err) {
    const cancelled = signal.aborted || (err as ApiError).code === "CANCELLED";
    inv.status = cancelled ? "cancelled" : "failed";
    inv.error = cancelled ? "Cancelled by user" : (err as Error).message;
    inv.progress.stages = inv.progress.stages.map((s) => (s.stage === current && s.status === "running" ? { ...s, status: "error", detail: inv.error } : s));
    log("error", inv.error ?? "Unknown error");
  } finally {
    running.delete(id);
    emit();
    progressBus.emit(id, { type: "done", status: inv.status, error: inv.error } satisfies ProgressEvent);
  }
}
