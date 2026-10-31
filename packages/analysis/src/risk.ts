import type {
  CodeFunction,
  Commit,
  EvidenceReference,
  ImportChange,
  RiskAssessment,
  RiskSignal,
  RiskSignalKind,
} from "@code-zero/shared";
import { functionsTouchingLines } from "./ast";
import {
  criticalPathKeyword,
  isBinaryPath,
  isConfigPath,
  isDocsPath,
  isJsTs,
  isLockfile,
  isManifest,
  isSourcePath,
  isTestPath,
} from "./classify";
import { changedNewLines, parsePatch, type DiffHunk, type DiffLine } from "./diff";

/** Weight table. Exposed so the UI can show exactly how scores are formed. */
export const SIGNAL_WEIGHTS: Record<RiskSignalKind, { max: number; label: string; detection: RiskSignal["detection"] }> = {
  "removed-validation": { max: 24, label: "Removed validation or guard", detection: "heuristic" },
  "error-handling": { max: 14, label: "Error-handling change", detection: "heuristic" },
  "control-flow": { max: 14, label: "Condition / operator change", detection: "heuristic" },
  "critical-path": { max: 10, label: "Business-critical path", detection: "heuristic" },
  "function-modified": { max: 12, label: "Exported functions modified", detection: "ast" },
  "high-fan-in": { max: 12, label: "Widely depended-upon file", detection: "ast" },
  "dependency-manifest": { max: 12, label: "Dependency manifest change", detection: "metadata" },
  configuration: { max: 8, label: "Configuration change", detection: "metadata" },
  "large-diff": { max: 12, label: "Large diff", detection: "metadata" },
  "missing-tests": { max: 8, label: "Source changed without test changes", detection: "metadata" },
  "import-change": { max: 6, label: "Import changes", detection: "heuristic" },
  "test-modified": { max: 8, label: "Test assertions removed", detection: "heuristic" },
  "symptom-match": { max: 20, label: "Matches reported symptoms", detection: "heuristic" },
};

export const MAX_FILES_PER_COMMIT = 300;

const VALIDATION_RE =
  /(\bif\s*\(.*(!|===?\s*(null|undefined)|!==?|[<>]=?|\.length|isNaN|typeof|instanceof).*\)\s*(\{|throw|return|continue)?|\bthrow\b|\b(validate|assert|invariant|ensure|sanitize|guard|check|verify|require)[A-Z_]?\w*\s*\(|Math\.(min|max)\(|\.(parse|safeParse)\(|\braise\b)/;
const ERROR_RE = /(\btry\b|\bcatch\b|\bfinally\b|\bthrow\b|\breject\(|\.catch\(|\bonError\b|\bexcept\b|\braise\b|\bpanic\(|\berr\s*!=\s*nil)/;
const COND_RE = /\b(if|while|for|else if|switch|case|return)\b|\?.*:/;
const OPERATORS_RE = /(===|!==|==|!=|<=|>=|&&|\|\||\?\?|<|>)/g;
const IMPORT_LINE_RE = /^\s*(import\s.+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|(?:const|let|var)\s+.+=\s*require\(\s*['"]([^'"]+)['"]\s*\)|from\s+([\w.]+)\s+import|import\s+([\w.]+))/;
const ASSERT_RE = /\b(expect|assert|should|toBe|toEqual|toThrow|assertEqual|assertTrue)\b/;

const STOPWORDS = new Set(
  "the and for with that this from when have been after into were when what which while about error errors issue issues broken break fails failed failing cannot should would could there their them they then than also only some more most very just like does doesnt dont been being onto over under user users report reports reported value values returns return true false null undefined function code page using used uses".split(
    " ",
  ),
);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const tokens = (s: string) => new Set(s.match(/[A-Za-z_$][\w$]*|\d+|===|!==|==|!=|<=|>=|&&|\|\||[<>!]/g) ?? []);

/** True when another line contains most of this line's tokens, i.e. the logic was moved or rewritten rather than dropped. */
function hasCounterpart(line: string, others: Set<string>[]): boolean {
  const t = tokens(line);
  if (t.size < 3) return false;
  return others.some((o) => {
    let hit = 0;
    for (const x of t) if (o.has(x)) hit++;
    return hit / t.size >= 0.7;
  });
}

export function symptomKeywords(symptoms: string | null | undefined): string[] {
  if (!symptoms) return [];
  const words = symptoms.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw)) continue;
    out.add(lw);
    // split camelCase / snake_case identifiers
    for (const part of w.split(/(?=[A-Z])|_/)) if (part.length >= 4 && !STOPWORDS.has(part.toLowerCase())) out.add(part.toLowerCase());
  }
  return [...out].slice(0, 30);
}

export function riskLevel(score: number): RiskAssessment["level"] {
  if (score >= 60) return "high";
  if (score >= 40) return "elevated";
  if (score >= 20) return "moderate";
  return "low";
}

export interface CommitAnalysisContext {
  /** Functions parsed from the post-commit version of changed JS/TS files. */
  functionsByFile?: Map<string, CodeFunction[]>;
  /** Number of dependent files per path (from the dependency graph). */
  fanIn?: Map<string, number>;
  symptoms?: string | null;
}

interface PairedChange {
  del: DiffLine;
  add: DiffLine;
}

/** Pairs removed and added lines within each change block, in order. */
function pairChanges(hunk: DiffHunk): PairedChange[] {
  const out: PairedChange[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.min(dels.length, adds.length);
    for (let i = 0; i < n; i++) out.push({ del: dels[i], add: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of hunk.lines) {
    if (l.type === "context") flush();
    else if (l.type === "del") {
      if (adds.length) flush();
      dels.push(l);
    } else adds.push(l);
  }
  flush();
  return out;
}

/** Computes a transparent heuristic risk assessment for one commit from its diff. */
export function assessCommit(commit: Commit, ctx: CommitAnalysisContext = {}): RiskAssessment {
  const signals: RiskSignal[] = [];
  const skippedFiles: { path: string; reason: string }[] = [];
  let evCounter = 0;
  const ev = (e: Omit<EvidenceReference, "id" | "commitSha">): EvidenceReference => ({
    ...e,
    id: `${commit.shortSha}-${++evCounter}`,
    commitSha: commit.sha,
  });
  const add = (kind: RiskSignalKind, weight: number, description: string, evidence: EvidenceReference[]) => {
    const meta = SIGNAL_WEIGHTS[kind];
    const w = Math.max(0, Math.min(meta.max, Math.round(weight)));
    if (w === 0 && kind !== "test-modified") return;
    signals.push({ id: `${commit.shortSha}:${kind}`, kind, label: meta.label, weight: w, detection: meta.detection, description, evidence });
  };

  const files = commit.files.slice(0, MAX_FILES_PER_COMMIT);
  if (commit.files.length > MAX_FILES_PER_COMMIT)
    skippedFiles.push({ path: "*", reason: `Only the first ${MAX_FILES_PER_COMMIT} of ${commit.files.length} files were analyzed` });

  const validationEv: EvidenceReference[] = [];
  const errorEv: EvidenceReference[] = [];
  const controlEv: EvidenceReference[] = [];
  const importChanges: ImportChange[] = [];
  const testWeakenEv: EvidenceReference[] = [];
  const rewrittenEv: EvidenceReference[] = [];
  const modifiedFunctions: CodeFunction[] = [];
  const keywords = symptomKeywords(ctx.symptoms);
  const symptomHits = new Map<string, EvidenceReference>();

  let sourceChanged = false;
  let testChanged = false;
  let churn = 0;

  for (const f of files) {
    if (f.binary || isBinaryPath(f.path)) {
      skippedFiles.push({ path: f.path, reason: "Binary file" });
      continue;
    }
    if (isLockfile(f.path)) {
      churn += 0; // lockfile churn is not code churn
    } else {
      churn += f.additions + f.deletions;
    }
    if (isTestPath(f.path)) testChanged = true;
    else if (isSourcePath(f.path)) sourceChanged = true;

    for (const kw of keywords) {
      if (f.path.toLowerCase().includes(kw) && !symptomHits.has(kw))
        symptomHits.set(kw, ev({ kind: "file", filePath: f.path, line: null, snippet: null, description: `File path matches symptom keyword "${kw}"` }));
    }

    if (f.patch === null) {
      if (!f.binary && f.additions + f.deletions > 0)
        skippedFiles.push({ path: f.path, reason: f.truncated ? "Diff too large (truncated by provider)" : "No patch available" });
      continue;
    }
    const hunks = parsePatch(f.patch);
    const isSrc = isSourcePath(f.path) && !isTestPath(f.path);
    const addedSet = new Set(hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => norm(l.content))));
    const addedTokens = hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => tokens(l.content)));
    const removedTokens = hunks.flatMap((h) => h.lines.filter((l) => l.type === "del").map((l) => tokens(l.content)));
    // Brand-new files cannot regress existing behavior; behavior-change signals only consider modified files.
    const existing = f.status !== "added";

    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.type === "context") continue;
        const text = l.content;
        const line = l.type === "add" ? l.newLine : l.oldLine;
        const loc = l.type === "add" ? "added" : "removed";
        if (isSrc && l.type === "del" && VALIDATION_RE.test(text) && !addedSet.has(norm(text)) && norm(text).length > 3) {
          if (hasCounterpart(text, addedTokens)) {
            rewrittenEv.push(ev({ kind: "diff-line", filePath: f.path, line, snippet: text.trim().slice(0, 200), description: "Guard-like line rewritten (most of its logic reappears in added lines)" }));
          } else validationEv.push(ev({ kind: "diff-line", filePath: f.path, line, snippet: text.trim().slice(0, 200), description: `Removed guard-like line (old line ${line})` }));
        }
        if (isSrc && existing && ERROR_RE.test(text) && !hasCounterpart(text, l.type === "add" ? removedTokens : addedTokens)) {
          errorEv.push(ev({ kind: "diff-line", filePath: f.path, line, snippet: text.trim().slice(0, 200), description: `Error-handling line ${loc}` }));
        }
        const im = IMPORT_LINE_RE.exec(text);
        if (im && (isSrc || isTestPath(f.path))) {
          const spec = im[2] ?? im[3] ?? im[4] ?? im[5] ?? im[6];
          if (spec) {
            let entry = importChanges.find((c) => c.filePath === f.path);
            if (!entry) importChanges.push((entry = { filePath: f.path, added: [], removed: [] }));
            (l.type === "add" ? entry.added : entry.removed).push(spec);
          }
        }
        if (isTestPath(f.path) && l.type === "del" && ASSERT_RE.test(text) && !addedSet.has(norm(text))) {
          testWeakenEv.push(ev({ kind: "diff-line", filePath: f.path, line, snippet: text.trim().slice(0, 200), description: "Test assertion removed" }));
        }
        for (const kw of keywords) {
          if (!symptomHits.has(kw) && text.toLowerCase().includes(kw))
            symptomHits.set(kw, ev({ kind: "diff-line", filePath: f.path, line, snippet: text.trim().slice(0, 200), description: `Diff line (${loc}) mentions "${kw}"` }));
        }
      }
      if (isSrc) {
        for (const { del, add: a } of pairChanges(h)) {
          if (!COND_RE.test(del.content) && !COND_RE.test(a.content)) continue;
          const dOps = del.content.match(OPERATORS_RE)?.join(" ") ?? "";
          const aOps = a.content.match(OPERATORS_RE)?.join(" ") ?? "";
          const sameShape = norm(del.content.replace(OPERATORS_RE, "∘")) === norm(a.content.replace(OPERATORS_RE, "∘"));
          if (dOps !== aOps && sameShape) {
            controlEv.push(ev({ kind: "diff-line", filePath: f.path, line: a.newLine, snippet: `${del.content.trim()}  →  ${a.content.trim()}`, description: `Comparison/logical operator changed (${dOps || "∅"} → ${aOps || "∅"})` }));
          } else if (/\b(if|while|else if)\s*\(/.test(del.content) && /\b(if|while|else if)\s*\(/.test(a.content) && norm(del.content) !== norm(a.content)) {
            controlEv.push(ev({ kind: "diff-line", filePath: f.path, line: a.newLine, snippet: `${del.content.trim()}  →  ${a.content.trim()}`, description: "Branch condition rewritten" }));
          }
        }
      }
    }

    // AST: which functions do the changed lines fall in?
    if (isJsTs(f.path) && ctx.functionsByFile?.has(f.path) && existing && f.status !== "removed") {
      const fns = functionsTouchingLines(ctx.functionsByFile.get(f.path)!, changedNewLines(hunks));
      for (const fn of fns) if (!modifiedFunctions.some((m) => m.id === fn.id)) modifiedFunctions.push(fn);
    }
  }

  // ── Signals ──
  if (validationEv.length)
    add("removed-validation", 10 + validationEv.length * 4, `${validationEv.length} removed line(s) look like validation, guards, clamps or throws and were not re-added elsewhere in the diff. Pattern-based; review manually.`, validationEv.slice(0, 12));
  if (errorEv.length)
    add("error-handling", 5 + errorEv.length * 2, `${errorEv.length} added/removed line(s) touch try/catch/throw/reject logic.`, errorEv.slice(0, 12));
  if (controlEv.length || rewrittenEv.length)
    add("control-flow", (controlEv.length ? 6 : 2) + controlEv.length * 3 + rewrittenEv.length, `${controlEv.length} condition(s) changed operators or were rewritten${rewrittenEv.length ? `; ${rewrittenEv.length} guard line(s) were restructured but their logic appears to be preserved` : ""}.`, [...controlEv, ...rewrittenEv].slice(0, 12));

  const critical = files.filter((f) => f.status !== "added" && isSourcePath(f.path) && criticalPathKeyword(f.path));
  if (critical.length)
    add("critical-path", 4 + critical.length * 3, `Touches files whose path suggests business-critical logic (${[...new Set(critical.map((f) => criticalPathKeyword(f.path)))].join(", ")}).`, critical.slice(0, 8).map((f) => ev({ kind: "file", filePath: f.path, line: null, snippet: null, description: `Path keyword "${criticalPathKeyword(f.path)}"` })));

  const exportedMods = modifiedFunctions.filter((f) => f.exported);
  if (modifiedFunctions.length)
    add("function-modified", exportedMods.length * 4 + (modifiedFunctions.length - exportedMods.length), `${modifiedFunctions.length} function(s) changed (${exportedMods.length} exported): ${modifiedFunctions.slice(0, 6).map((f) => f.name).join(", ")}${modifiedFunctions.length > 6 ? "…" : ""}`, modifiedFunctions.slice(0, 10).map((fn) => ev({ kind: "ast", filePath: fn.filePath, line: fn.startLine, snippet: null, description: `${fn.kind} ${fn.name} (lines ${fn.startLine}–${fn.endLine}) contains changed lines` })));

  if (ctx.fanIn) {
    const fanned = files
      .filter((f) => f.status !== "added")
      .map((f) => ({ f, n: ctx.fanIn!.get(f.path) ?? 0 }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => b.n - a.n);
    if (fanned.length)
      add("high-fan-in", fanned[0].n * 3, `Changed file(s) imported by other files: ${fanned.slice(0, 4).map((x) => `${x.f.path} (${x.n})`).join(", ")}`, fanned.slice(0, 6).map((x) => ev({ kind: "import", filePath: x.f.path, line: null, snippet: null, description: `${x.n} file(s) import ${x.f.path}` })));
  }

  const manifests = files.filter((f) => isManifest(f.path));
  if (manifests.length)
    add("dependency-manifest", 6 + manifests.filter((f) => !isLockfile(f.path)).length * 4 + (manifests.some((f) => isLockfile(f.path)) ? 2 : 0), `Dependency manifest(s) changed: ${manifests.map((f) => f.path).join(", ")}`, manifests.map((f) => ev({ kind: "manifest", filePath: f.path, line: null, snippet: null, description: `${f.status} manifest (+${f.additions}/−${f.deletions})` })));

  const configs = files.filter((f) => isConfigPath(f.path));
  if (configs.length)
    add("configuration", 3 + configs.length * 2, `Configuration file(s) changed: ${configs.slice(0, 5).map((f) => f.path).join(", ")}`, configs.slice(0, 8).map((f) => ev({ kind: "file", filePath: f.path, line: null, snippet: null, description: `${f.status} config (+${f.additions}/−${f.deletions})` })));

  if (churn >= 150) {
    const w = churn >= 1000 ? 12 : churn >= 500 ? 9 : churn >= 250 ? 6 : 4;
    add("large-diff", w, `${churn} changed lines across ${files.length} file(s) (lockfiles excluded).`, [ev({ kind: "commit", filePath: null, line: null, snippet: null, description: `${churn} lines changed` })]);
  }

  if (sourceChanged && !testChanged) {
    const srcFiles = files.filter((f) => isSourcePath(f.path) && !isTestPath(f.path));
    add("missing-tests", srcFiles.length > 2 ? 8 : 6, "Source files changed but no test files were modified in this commit.", srcFiles.slice(0, 5).map((f) => ev({ kind: "file", filePath: f.path, line: null, snippet: null, description: "Source changed without accompanying test change" })));
  }

  const importTotal = importChanges.reduce((s, c) => s + c.added.length + c.removed.length, 0);
  if (importTotal)
    add("import-change", 2 + importTotal, `${importTotal} import statement(s) added or removed.`, importChanges.slice(0, 6).map((c) => ev({ kind: "import", filePath: c.filePath, line: null, snippet: [...c.added.map((a) => `+ ${a}`), ...c.removed.map((r) => `− ${r}`)].join(", "), description: "Import change" })));

  if (testWeakenEv.length) add("test-modified", 3 + testWeakenEv.length * 2, `${testWeakenEv.length} test assertion(s) removed.`, testWeakenEv.slice(0, 8));

  if (symptomHits.size)
    add("symptom-match", symptomHits.size * 5, `Diff or paths match ${symptomHits.size} keyword(s) from the reported symptoms: ${[...symptomHits.keys()].join(", ")}`, [...symptomHits.values()]);

  if (files.length && files.every((f) => isDocsPath(f.path))) {
    // Documentation-only commits keep whatever (usually zero) score they have; no inflation.
  }

  signals.sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  return { commitSha: commit.sha, score, level: riskLevel(score), signals, modifiedFunctions, importChanges, skippedFiles };
}
