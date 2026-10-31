import type { AITask, AnalysisResult, ChangedFile, EvidenceReference, ExplanationLevel, Investigation, Repository } from "@code-zero/shared";
import { MODE_LABELS } from "@code-zero/shared";
import { computeBlastRadius } from "@code-zero/analysis";

export const CONTEXT_BUDGET = 14_000; // characters of diff text sent to the model
const MAX_LINES_PER_FILE = 140;

export interface BuiltContext {
  text: string;
  evidence: EvidenceReference[];
}

function trimPatch(patch: string): string {
  const lines = patch.split("\n");
  if (lines.length <= MAX_LINES_PER_FILE) return patch;
  return `${lines.slice(0, MAX_LINES_PER_FILE).join("\n")}\n… (${lines.length - MAX_LINES_PER_FILE} more diff lines omitted)`;
}

/**
 * Builds a bounded, evidence-indexed context. Every item the model may cite has an ID in [brackets];
 * IDs not present here are flagged as unknown after generation.
 */
export function buildContext(args: {
  repo: Repository;
  inv: Investigation;
  analysis: AnalysisResult;
  commitSha: string | null;
  compare?: { base: string; head: string; files: ChangedFile[] } | null;
}): BuiltContext {
  const { repo, inv, analysis, commitSha, compare } = args;
  const evidence: EvidenceReference[] = [];
  const L: string[] = [];

  L.push(`REPOSITORY: ${repo.fullName}${repo.isDemo ? " (simulated demo)" : ""} — ${repo.description ?? "no description"}; primary language ${repo.primaryLanguage ?? "unknown"}.`);
  L.push(`INVESTIGATION MODE: ${MODE_LABELS[inv.mode].title} on branch ${inv.branch}; ${analysis.commits.length} commits analyzed.`);
  if (inv.params.symptoms) L.push(`USER-REPORTED SYMPTOMS:\n${inv.params.symptoms.slice(0, 1500)}`);

  const top = inv.findings.slice(0, 5);
  if (top.length) {
    L.push("TOP HEURISTIC SUSPECTS (score 0–100, not a probability):");
    for (const f of top) L.push(`  - ${f.commitSha.slice(0, 7)} score ${f.score} [${f.status}] "${f.title}"`);
  }

  const commit = commitSha ? analysis.commits.find((c) => c.sha === commitSha || c.sha.startsWith(commitSha)) : null;
  let diffFiles: ChangedFile[] = [];
  if (commit) {
    const a = analysis.assessments.find((x) => x.commitSha === commit.sha);
    L.push("");
    L.push(`SELECTED COMMIT ${commit.sha} by ${commit.author.name} on ${commit.date}`);
    L.push(`Message: ${commit.message.slice(0, 600)}`);
    L.push(`Files: ${commit.files.map((f) => `${f.path} (${f.status} +${f.additions}/-${f.deletions})`).join(", ")}`);
    if (a) {
      L.push(`Heuristic risk score: ${a.score}/100 (${a.level})`);
      L.push("RISK SIGNALS (deterministic analysis; 'heuristic' = pattern-based):");
      for (const s of a.signals) {
        L.push(`  * ${s.label} (+${s.weight}, ${s.detection}): ${s.description}`);
        for (const e of s.evidence.slice(0, 6)) {
          evidence.push(e);
          L.push(`      [${e.id}] ${e.filePath ?? ""}${e.line ? `:${e.line}` : ""} ${e.description}${e.snippet ? ` :: ${e.snippet}` : ""}`);
        }
      }
      if (a.modifiedFunctions.length) L.push(`MODIFIED FUNCTIONS (AST): ${a.modifiedFunctions.map((f) => `${f.filePath}#${f.name} (lines ${f.startLine}-${f.endLine}${f.exported ? ", exported" : ""})`).join("; ")}`);
      if (analysis.graph) {
        const br = computeBlastRadius(analysis.graph, { commitSha: commit.sha, changedFiles: commit.files.map((f) => f.path), modifiedFunctionIds: a.modifiedFunctions.map((f) => f.id) });
        const names = br.affected.slice(0, 20).map((x) => `${x.id.replace(/^(file|fn):/, "")} (depth ${x.depth}, via ${x.via})`);
        L.push(`POTENTIAL DOWNSTREAM DEPENDENTS (static graph, not confirmed breakage): ${names.length ? names.join("; ") : "none found"}`);
        if (br.relatedTests.length) L.push(`RELATED TEST FILES: ${br.relatedTests.join(", ")}`);
      }
    }
    diffFiles = commit.files;
  }

  if (compare) {
    L.push("");
    L.push(`COMPARISON: ${compare.base.slice(0, 7)} (known working) → ${compare.head.slice(0, 7)} (suspected broken)`);
    diffFiles = compare.files;
  }

  const verification = analysis.bisect?.verification ?? [];
  if (verification.length) {
    L.push("");
    L.push("TEST VERIFICATION RESULTS (deterministic demo harness):");
    for (const v of verification) {
      const id = `test:${v.commitSha.slice(0, 7)}`;
      evidence.push({ id, kind: "test-result", commitSha: v.commitSha, filePath: null, line: null, snippet: null, description: v.summary });
      L.push(`  [${id}] ${v.commitSha.slice(0, 7)}: ${v.summary} ${v.results.filter((r) => !r.passed).map((r) => `FAILED "${r.testName}" (${r.message})`).join("; ")}`);
    }
  } else {
    L.push("TEST RESULTS: none available. Do not claim any test passed or failed.");
  }

  // Bounded diff excerpts: files referenced by evidence first.
  const cited = new Set(evidence.map((e) => e.filePath));
  const ordered = [...diffFiles].filter((f) => f.patch).sort((a, b) => Number(cited.has(b.path)) - Number(cited.has(a.path)) || b.additions + b.deletions - (a.additions + a.deletions));
  let budget = CONTEXT_BUDGET;
  const omitted: string[] = [];
  L.push("");
  L.push("DIFF EXCERPTS:");
  for (const f of ordered) {
    const text = trimPatch(f.patch!);
    if (text.length > budget) {
      omitted.push(f.path);
      continue;
    }
    budget -= text.length;
    const id = `diff:${f.path}`;
    evidence.push({ id, kind: "file", commitSha: compare?.head ?? commit?.sha ?? null, filePath: f.path, line: null, snippet: null, description: `Diff of ${f.path}` });
    L.push(`[${id}]\n${text}`);
  }
  if (omitted.length) L.push(`(Diffs omitted for context budget: ${omitted.join(", ")})`);

  return { text: L.join("\n"), evidence };
}

const LEVEL: Record<ExplanationLevel, string> = {
  beginner: "Explain for a junior developer: plain language, define terms, short sentences.",
  developer: "Explain for a working software engineer: concise and concrete.",
  expert: "Explain for a senior engineer: terse, precise, focus on mechanisms and edge cases.",
};

const TASK: Record<AITask, string> = {
  "root-cause": "Perform ROOT CAUSE ANALYSIS: explain the most likely failure mechanism introduced by the selected commit and how it would produce the reported symptoms (if any).",
  "semantic-diff": "Perform SEMANTIC DIFF ANALYSIS: explain what behavior differs between the versions, why it matters, which edge cases may now fail, and which tests would verify it.",
  impact: "Perform IMPACT ANALYSIS: describe the potential downstream effects of this change through the listed dependents. Distinguish direct effects from possible indirect ones.",
  tests: "Generate REGRESSION TESTS: propose focused tests (with runnable code in the repository's language/test framework if evident) that would detect the suspected regression.",
  fix: "Recommend FIXES: describe candidate code changes and their trade-offs.",
  alternatives: "Identify ALTERNATIVE HYPOTHESES: list competing explanations for the symptoms, including ones that do NOT blame the selected commit, and what evidence would distinguish them.",
  "commit-investigation": "Explain WHY THIS COMMIT WAS FLAGGED: walk through each risk signal, say which look genuinely concerning and which may be false positives.",
};

export function systemPrompt(task: AITask, level: ExplanationLevel): string {
  return [
    "You are Gemma, the diagnostic engine of CODE ZERO, a software regression investigation tool.",
    TASK[task],
    LEVEL[level],
    "Rules:",
    "- Ground every significant claim in the provided context and cite evidence IDs exactly as written inside [brackets] (without the brackets) in evidenceIds.",
    "- Never invent file names, line numbers, commit SHAs, functions, or test results that are not in the context.",
    "- 'observations' are facts directly visible in the evidence. 'hypotheses' are interpretations; give each a confidence.",
    "- Risk scores are heuristics, not probabilities. Possible impact is not confirmed breakage.",
    "- State what is uncertain or missing in uncertaintyNotes.",
    "- Respond ONLY with a JSON object with keys: summary, observations[{text,evidenceIds}], hypotheses[{title,explanation,confidence(low|medium|high),evidenceIds}], riskExplanation, suggestedTests[{name,description,targetFile,code}], recommendedActions[], uncertaintyNotes[].",
  ].join("\n");
}

export function chatSystemPrompt(level: ExplanationLevel, context: string | null): string {
  return [
    "You are Gemma, the diagnostic assistant inside CODE ZERO, a tool that investigates software regressions (themed as infections: repository = patient, commit = mutation, suspected regression commit = Patient Zero).",
    LEVEL[level],
    "Answer using the investigation context below. Use Markdown. Quote code in fenced blocks.",
    "Cite evidence IDs like [abc1234-3] when you rely on them. Never invent files, lines, commits or test results; say when the context does not contain the answer.",
    "Clearly separate what the evidence shows from what you are speculating.",
    context ? `\n=== INVESTIGATION CONTEXT ===\n${context}` : "\nNo investigation is loaded; answer general questions and suggest importing a repository.",
  ].join("\n");
}

