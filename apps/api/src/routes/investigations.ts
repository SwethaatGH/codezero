import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CompareResult, Investigation, ProgressEvent } from "@code-zero/shared";
import { compareSchema, createInvestigationSchema, fileContentsSchema, importRepositorySchema, updateInvestigationSchema, MODE_LABELS } from "@code-zero/shared";
import { computeBlastRadius, DEMO_SYMPTOMS, diffFunctions, diffPackageJson, isConfigPath, parseRepoInput } from "@code-zero/analysis";
import type { DB } from "../db";
import { ApiError, notFound } from "../errors";
import { cancelInvestigation, initialProgress, isRunning, progressBus, runInvestigation } from "../pipeline";
import { DemoSource, sourceFor } from "../sources";

export function newInvestigation(input: z.output<typeof createInvestigationSchema>, repo: { id: string; fullName: string; isDemo: boolean }): Investigation {
  const now = new Date().toISOString();
  return {
    id: `inv_${randomUUID().slice(0, 12)}`,
    name: input.name?.trim() || `${MODE_LABELS[input.mode].title} · ${repo.fullName}`,
    repositoryId: repo.id,
    repoFullName: repo.fullName,
    branch: input.branch,
    mode: input.mode,
    status: "created",
    isDemo: repo.isDemo,
    params: { limit: input.limit, since: input.since, until: input.until, goodSha: input.goodSha, badSha: input.badSha, commitSha: input.commitSha, symptoms: input.symptoms },
    createdAt: now,
    updatedAt: now,
    commitRange: { from: null, to: null, count: 0 },
    selectedCommitSha: null,
    knownGoodSha: input.goodSha,
    knownBadSha: input.badSha,
    findings: [],
    notes: [],
    bookmarks: [],
    progress: initialProgress(repo.isDemo),
    error: null,
    reportIds: [],
  };
}

export function registerInvestigationRoutes(app: FastifyInstance, db: DB, opts: { demoPacingMs?: number }) {
  const getInv = (id: string) => {
    const inv = db.getInvestigation(id);
    if (!inv) throw notFound("Investigation");
    return inv;
  };
  const start = (id: string) => void runInvestigation(db, id, { demoPacingMs: opts.demoPacingMs });

  // ── Repositories ──
  app.post("/api/repositories/import", async (req) => {
    const { input } = importRepositorySchema.parse(req.body);
    if (/^demo$/i.test(input.trim()) || input.trim() === "code-zero-demo/orbit-checkout") {
      const repo = await new DemoSource().getRepository();
      db.saveRepository(repo);
      return { repository: repo, branches: await new DemoSource().listBranches() };
    }
    const ref = parseRepoInput(input);
    if (!ref) throw new ApiError(400, "INVALID_REPOSITORY_INPUT", "Enter a GitHub URL (https://github.com/owner/repo) or owner/repo.");
    const src = sourceFor(db, `${ref.owner}/${ref.name}`);
    const repo = await src.getRepository();
    const branches = await src.listBranches().catch(() => [{ name: repo.defaultBranch, sha: repo.latestCommitSha ?? "", protected: null }]);
    db.saveRepository(repo);
    return { repository: repo, branches };
  });

  app.get<{ Params: { owner: string; name: string } }>("/api/repositories/:owner/:name", async (req) => {
    const repo = db.getRepository(`${req.params.owner}/${req.params.name}`);
    if (!repo) throw notFound("Repository");
    return repo;
  });
  app.get<{ Params: { owner: string; name: string } }>("/api/repositories/:owner/:name/branches", async (req) => sourceFor(db, `${req.params.owner}/${req.params.name}`).listBranches());
  app.get<{ Params: { owner: string; name: string }; Querystring: { branch?: string; limit?: string } }>("/api/repositories/:owner/:name/commits", async (req) => {
    const id = `${req.params.owner}/${req.params.name}`;
    const repo = db.getRepository(id);
    const limit = z.coerce.number().int().min(1).max(100).catch(30).parse(req.query.limit);
    return sourceFor(db, id).listCommits({ branch: req.query.branch ?? repo?.defaultBranch ?? "main", limit, since: null, until: null });
  });

  // ── Demo ──
  app.post("/api/demo/launch", async () => {
    const src = new DemoSource();
    const repo = await src.getRepository();
    db.saveRepository(repo);
    const input = createInvestigationSchema.parse({ repositoryId: repo.id, branch: "main", mode: "ai-guided", limit: 20, symptoms: DEMO_SYMPTOMS, name: "Demo · Negative checkout totals" });
    const inv = newInvestigation(input, repo);
    db.saveInvestigation(inv);
    start(inv.id);
    return db.getInvestigation(inv.id) ?? inv;
  });

  // ── Investigations ──
  app.post("/api/investigations", async (req, reply) => {
    const input = createInvestigationSchema.parse(req.body);
    const repo = db.getRepository(input.repositoryId);
    if (!repo) throw new ApiError(404, "REPOSITORY_NOT_IMPORTED", "Import the repository before starting an investigation.");
    const inv = newInvestigation(input, repo);
    db.saveInvestigation(inv);
    if ((req.query as { start?: string }).start !== "false") start(inv.id);
    return reply.status(201).send(db.getInvestigation(inv.id) ?? inv);
  });

  app.get("/api/investigations", async () => db.listInvestigations());
  app.get<{ Params: { id: string } }>("/api/investigations/:id", async (req) => getInv(req.params.id));

  app.patch<{ Params: { id: string } }>("/api/investigations/:id", async (req) => {
    const inv = getInv(req.params.id);
    const patch = updateInvestigationSchema.parse(req.body);
    const next: Investigation = { ...inv, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: new Date().toISOString() };
    db.saveInvestigation(next);
    return next;
  });

  app.delete<{ Params: { id: string } }>("/api/investigations/:id", async (req, reply) => {
    cancelInvestigation(req.params.id);
    if (!db.deleteInvestigation(req.params.id)) throw notFound("Investigation");
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/investigations/:id/duplicate", async (req, reply) => {
    const inv = getInv(req.params.id);
    const now = new Date().toISOString();
    const copy: Investigation = { ...inv, id: `inv_${randomUUID().slice(0, 12)}`, name: `${inv.name} (copy)`, status: "created", createdAt: now, updatedAt: now, findings: [], reportIds: [], error: null, progress: initialProgress(inv.isDemo) };
    db.saveInvestigation(copy);
    return reply.status(201).send(copy);
  });

  app.post<{ Params: { id: string } }>("/api/investigations/:id/analyze", async (req, reply) => {
    const inv = getInv(req.params.id);
    if (isRunning(inv.id)) throw new ApiError(409, "ALREADY_RUNNING", "Analysis is already running.");
    start(inv.id);
    return reply.status(202).send({ started: true });
  });

  app.post<{ Params: { id: string } }>("/api/investigations/:id/cancel", async (req) => {
    getInv(req.params.id);
    return { cancelled: cancelInvestigation(req.params.id) };
  });

  // Server-Sent Events progress stream.
  app.get<{ Params: { id: string } }>("/api/investigations/:id/progress", async (req, reply) => {
    const inv = getInv(req.params.id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": (req.headers.origin as string) ?? "*",
    });
    const send = (ev: ProgressEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: "progress", progress: inv.progress, status: inv.status });
    if (!isRunning(inv.id) && inv.status !== "running") {
      send({ type: "done", status: inv.status, error: inv.error });
      res.end();
      return;
    }
    const onEvent = (ev: ProgressEvent) => {
      send(ev);
      if (ev.type === "done") cleanup();
    };
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    const cleanup = () => {
      clearInterval(ping);
      progressBus.off(inv.id, onEvent);
      res.end();
    };
    progressBus.on(inv.id, onEvent);
    req.raw.on("close", cleanup);
  });

  const getAnalysis = (id: string) => {
    getInv(id);
    const a = db.getAnalysis(id);
    if (!a) throw new ApiError(409, "ANALYSIS_INCOMPLETE", "Analysis has not completed for this investigation.");
    return a;
  };

  app.get<{ Params: { id: string } }>("/api/investigations/:id/findings", async (req) => {
    const inv = getInv(req.params.id);
    const a = db.getAnalysis(inv.id);
    return { findings: inv.findings, bisect: a?.bisect ?? null };
  });

  app.get<{ Params: { id: string } }>("/api/investigations/:id/timeline", async (req) => {
    const a = getAnalysis(req.params.id);
    return { commits: a.commits, assessments: a.assessments, bisect: a.bisect };
  });

  app.get<{ Params: { id: string } }>("/api/investigations/:id/graph", async (req) => {
    const a = getAnalysis(req.params.id);
    return a.graph;
  });

  app.get<{ Params: { id: string }; Querystring: { sha?: string } }>("/api/investigations/:id/impact", async (req) => {
    const inv = getInv(req.params.id);
    const a = getAnalysis(req.params.id);
    const sha = req.query.sha ?? inv.selectedCommitSha ?? a.commits[0]?.sha;
    const commit = a.commits.find((c) => c.sha === sha || c.sha.startsWith(sha ?? "~"));
    if (!commit) throw new ApiError(404, "COMMIT_NOT_IN_INVESTIGATION", `Commit ${sha} is not part of this investigation.`);
    if (!a.graph) return { graph: null, blastRadius: { commitSha: commit.sha, seeds: [], modifiedFunctions: [], directDependents: [], affected: [], relatedTests: [], classification: "unknown", notes: ["Dependency graph unavailable for this investigation."] } };
    const assessment = a.assessments.find((x) => x.commitSha === commit.sha);
    const blastRadius = computeBlastRadius(a.graph, {
      commitSha: commit.sha,
      changedFiles: commit.files.map((f) => f.path),
      modifiedFunctionIds: assessment?.modifiedFunctions.map((f) => f.id) ?? [],
    });
    if (a.graph.headSha !== commit.sha) blastRadius.notes.push(`Graph reflects the latest analyzed commit (${a.graph.headSha?.slice(0, 7)}); relationships may differ at ${commit.shortSha}.`);
    return { graph: a.graph, blastRadius };
  });

  app.get<{ Params: { id: string } }>("/api/investigations/:id/health", async (req) => getAnalysis(req.params.id).health);

  app.post("/api/compare", async (req): Promise<CompareResult> => {
    const { investigationId, base, head } = compareSchema.parse(req.body);
    const inv = getInv(investigationId);
    const src = sourceFor(db, inv.repositoryId);
    const files = await src.compareFiles(base, head);
    const a = db.getAnalysis(investigationId);
    const commits = (a?.commits ?? [])
      .filter((c) => {
        const chrono = [...(a?.commits ?? [])].reverse();
        const bi = chrono.findIndex((x) => x.sha.startsWith(base));
        const hi = chrono.findIndex((x) => x.sha.startsWith(head));
        const ci = chrono.indexOf(c);
        return bi !== -1 && hi !== -1 && ci > Math.min(bi, hi) && ci <= Math.max(bi, hi);
      })
      .map((c) => ({ sha: c.sha, shortSha: c.shortSha, message: c.message, date: c.date }));

    const dependencyChanges: CompareResult["dependencyChanges"] = [];
    const functionChanges: CompareResult["functionChanges"] = [];
    for (const f of files.filter((x) => !x.binary).slice(0, 40)) {
      if (/(^|\/)package\.json$/.test(f.path)) {
        const [before, after] = await Promise.all([f.status === "added" ? null : src.getFile(f.previousPath ?? f.path, base), f.status === "removed" ? null : src.getFile(f.path, head)]);
        const d = diffPackageJson(before, after);
        if (d) dependencyChanges.push({ path: f.path, ...d });
      }
      if (/\.(m|c)?(t|j)sx?$/.test(f.path) && f.additions + f.deletions > 0) {
        try {
          const [before, after] = await Promise.all([f.status === "added" ? null : src.getFile(f.previousPath ?? f.path, base), f.status === "removed" ? null : src.getFile(f.path, head)]);
          functionChanges.push(...diffFunctions(f.path, before, after));
        } catch (err) {
          req.log.warn({ err, path: f.path }, "function diff skipped");
        }
      }
    }
    return {
      base,
      head,
      files,
      commits,
      totals: { additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0), files: files.length },
      dependencyChanges,
      configChanges: files.filter((f) => isConfigPath(f.path)).map((f) => f.path),
      functionChanges,
    };
  });

  app.post("/api/files", async (req) => {
    const { investigationId, path, ref } = fileContentsSchema.parse(req.body);
    const inv = getInv(investigationId);
    const content = await sourceFor(db, inv.repositoryId).getFile(path, ref);
    return { path, ref, content, missing: content === null };
  });

  // ── Global search ──
  app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => {
    const q = (req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2) return { commits: [], files: [], functions: [], findings: [], investigations: [] };
    const invs = db.listInvestigations();
    const out = {
      investigations: invs.filter((i) => `${i.name} ${i.repoFullName} ${i.id}`.toLowerCase().includes(q)).slice(0, 8).map((i) => ({ id: i.id, name: i.name, repo: i.repoFullName, status: i.status })),
      commits: [] as { investigationId: string; sha: string; message: string }[],
      files: [] as { investigationId: string; path: string }[],
      functions: [] as { investigationId: string; id: string; name: string; filePath: string }[],
      findings: [] as { investigationId: string; commitSha: string; title: string; score: number }[],
    };
    for (const inv of invs.slice(0, 10)) {
      const a = db.getAnalysis(inv.id);
      if (!a) continue;
      for (const c of a.commits) if (out.commits.length < 15 && (c.sha.startsWith(q) || c.message.toLowerCase().includes(q) || c.author.name.toLowerCase().includes(q))) out.commits.push({ investigationId: inv.id, sha: c.sha, message: c.message.split("\n")[0] });
      const paths = new Set(a.commits.flatMap((c) => c.files.map((f) => f.path)));
      for (const p of paths) if (out.files.length < 15 && p.toLowerCase().includes(q)) out.files.push({ investigationId: inv.id, path: p });
      for (const n of a.graph?.nodes ?? []) if (out.functions.length < 15 && n.kind !== "file" && n.label.toLowerCase().includes(q)) out.functions.push({ investigationId: inv.id, id: n.id, name: n.label, filePath: n.filePath ?? "" });
      for (const f of inv.findings) if (out.findings.length < 10 && `${f.title} ${f.commitSha}`.toLowerCase().includes(q)) out.findings.push({ investigationId: inv.id, commitSha: f.commitSha, title: f.title, score: f.score });
    }
    return out;
  });
}
