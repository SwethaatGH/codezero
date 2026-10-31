import type {
  AIAnalysis,
  AnalysisResult,
  Investigation,
  InvestigationReport,
  PatchSuggestion,
  Repository,
} from "@code-zero/shared";
import { FINDING_STATUS_LABELS, MODE_LABELS } from "@code-zero/shared";
import { firstLine } from "./ranking";

export interface ReportInput {
  id: string;
  createdAt: string;
  investigation: Investigation;
  repository: Repository;
  analysis: AnalysisResult | null;
  aiAnalyses: AIAnalysis[];
  patches: PatchSuggestion[];
}

/** Assembles a report strictly from stored data. Incomplete investigations produce an explicitly incomplete report. */
export function buildReport(input: ReportInput): InvestigationReport {
  const { investigation: inv, repository: repo, analysis } = input;
  const complete = inv.status === "completed" && !!analysis;
  const commits = analysis?.commits ?? [];
  const assessments = new Map((analysis?.assessments ?? []).map((a) => [a.commitSha, a]));
  const bySha = new Map(commits.map((c) => [c.sha, c]));

  const summary: string[] = [];
  const limitations: string[] = [];
  if (!complete) {
    summary.push(`Investigation status is "${inv.status}". No findings are reported until analysis completes.`);
  } else {
    summary.push(`${commits.length} commit(s) on ${inv.branch} were analyzed in ${MODE_LABELS[inv.mode].title} mode.`);
    const top = inv.findings[0];
    if (top) {
      const c = bySha.get(top.commitSha);
      summary.push(
        `Highest-ranked candidate: ${c?.shortSha ?? top.commitSha.slice(0, 7)} "${top.title}" with heuristic score ${top.score}/100 (${FINDING_STATUS_LABELS[top.status]}).`,
      );
    } else {
      summary.push("No commit produced a non-zero heuristic risk score.");
    }
    if (analysis?.bisect?.firstBadSha) {
      const c = bySha.get(analysis.bisect.firstBadSha);
      summary.push(`Deterministic test verification identified ${c?.shortSha ?? analysis.bisect.firstBadSha.slice(0, 7)} as the first commit where the verification suite fails.`);
    }
    const live = input.aiAnalyses.filter((a) => a.source === "live");
    if (live.length) summary.push(`${live.length} Gemma analysis result(s) are attached; they are hypotheses, not verified conclusions.`);
  }

  if (repo.isDemo) limitations.push("This investigation uses the built-in SIMULATED demo repository.");
  limitations.push("Risk scores are transparent heuristics (0–100), not calibrated probabilities of failure.");
  if (analysis?.graph) limitations.push(...analysis.graph.limitations);
  if (!analysis?.bisect) limitations.push("No automated test verification was run; findings remain unverified.");
  if (input.patches.some((p) => !p.verified)) limitations.push("Proposed patches are UNVERIFIED: they have not been tested.");
  if (input.aiAnalyses.some((a) => a.source === "prerecorded-demo")) limitations.push("Some AI analysis is PRERECORDED demo content, not live inference.");
  const skipped = (analysis?.assessments ?? []).flatMap((a) => a.skippedFiles);
  if (skipped.length) limitations.push(`${skipped.length} file(s) were skipped during analysis (binary, truncated, or over limits).`);

  const modifiedFiles = [...new Set(commits.flatMap((c) => c.files.map((f) => f.path)))].sort();
  const affectedFunctions = [...new Set((analysis?.assessments ?? []).flatMap((a) => a.modifiedFunctions.map((f) => `${f.filePath}#${f.name}`)))].sort();

  const scores = (analysis?.assessments ?? []).map((a) => a.score);
  const riskIndicators = complete
    ? [
        { label: "Commits analyzed", value: String(commits.length) },
        { label: "Commits scoring ≥ 40", value: String(scores.filter((s) => s >= 40).length) },
        { label: "Highest score", value: scores.length ? String(Math.max(...scores)) : "—" },
        { label: "Files modified", value: String(modifiedFiles.length) },
        { label: "Functions modified (AST)", value: String(affectedFunctions.length) },
        { label: "Verification", value: analysis?.bisect ? (analysis.bisect.firstBadSha ? "Regression reproduced" : "No failing commit found") : "Not run" },
      ]
    : [];

  return {
    id: input.id,
    investigationId: inv.id,
    title: `${inv.name} — Medical Record`,
    createdAt: input.createdAt,
    repository: { fullName: repo.fullName, htmlUrl: repo.htmlUrl, defaultBranch: repo.defaultBranch, isDemo: repo.isDemo, description: repo.description },
    mode: inv.mode,
    branch: inv.branch,
    commitRange: inv.commitRange,
    symptoms: inv.params.symptoms,
    summary,
    riskIndicators,
    suspiciousCommits: complete
      ? inv.findings.map((f) => ({
          sha: f.commitSha,
          message: firstLine(bySha.get(f.commitSha)?.message ?? f.title),
          score: f.score,
          status: f.status,
          signals: (assessments.get(f.commitSha)?.signals ?? []).map((s) => ({ label: s.label, detection: s.detection, weight: s.weight })),
        }))
      : [],
    evidence: complete ? inv.findings.flatMap((f) => f.evidence).slice(0, 60) : [],
    modifiedFiles: complete ? modifiedFiles : [],
    affectedFunctions: complete ? affectedFunctions : [],
    aiAnalyses: input.aiAnalyses,
    patches: input.patches,
    verification: analysis?.bisect?.verification ?? [],
    limitations,
    complete,
  };
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function reportToMarkdown(r: InvestigationReport): string {
  const L: string[] = [];
  L.push(`# ${r.title}`, "");
  if (r.repository.isDemo) L.push("> **SIMULATED DEMO DATA** — this report was generated from the built-in demo repository.", "");
  L.push(`- **Repository:** ${r.repository.fullName}${r.repository.htmlUrl ? ` (${r.repository.htmlUrl})` : ""}`);
  L.push(`- **Investigation ID:** \`${r.investigationId}\``);
  L.push(`- **Report ID:** \`${r.id}\``);
  L.push(`- **Generated:** ${r.createdAt}`);
  L.push(`- **Mode:** ${MODE_LABELS[r.mode].title}`);
  L.push(`- **Branch:** ${r.branch}`);
  L.push(`- **Commit range:** ${r.commitRange.from?.slice(0, 7) ?? "?"} … ${r.commitRange.to?.slice(0, 7) ?? "?"} (${r.commitRange.count} commits)`);
  L.push(`- **Status:** ${r.complete ? "Complete" : "INCOMPLETE"}`, "");
  if (r.symptoms) L.push("## Reported Symptoms", "", "```", r.symptoms, "```", "");
  L.push("## Summary", "", ...r.summary.map((s) => `- ${s}`), "");
  if (r.riskIndicators.length) {
    L.push("## Risk Indicators", "", "| Indicator | Value |", "|---|---|", ...r.riskIndicators.map((i) => `| ${esc(i.label)} | ${esc(i.value)} |`), "");
  }
  if (r.suspiciousCommits.length) {
    L.push("## Suspicious Commits (Patient Zero candidates)", "", "| Rank | Commit | Message | Score | Status |", "|---|---|---|---|---|");
    r.suspiciousCommits.forEach((c, i) => L.push(`| ${i + 1} | \`${c.sha.slice(0, 7)}\` | ${esc(c.message)} | ${c.score} | ${FINDING_STATUS_LABELS[c.status]} |`));
    L.push("");
    for (const c of r.suspiciousCommits) {
      L.push(`### \`${c.sha.slice(0, 7)}\` — ${c.message}`, "");
      for (const s of c.signals) L.push(`- ${s.label} (+${s.weight}, ${s.detection})`);
      L.push("");
    }
  }
  if (r.evidence.length) {
    L.push("## Evidence", "");
    for (const e of r.evidence) L.push(`- **[${e.id}]** ${e.filePath ?? ""}${e.line ? `:${e.line}` : ""} — ${e.description}${e.snippet ? `\n  \`${e.snippet.replace(/`/g, "'")}\`` : ""}`);
    L.push("");
  }
  if (r.verification.length) {
    L.push("## Verification", "");
    for (const v of r.verification) {
      L.push(`- \`${v.commitSha.slice(0, 7)}\` (${v.method}): ${v.summary}`);
      for (const t of v.results) L.push(`  - ${t.passed ? "✅" : "❌"} ${t.testName}${t.message ? ` — ${t.message}` : ""}`);
    }
    L.push("");
  }
  if (r.aiAnalyses.length) {
    L.push("## AI Analysis (Gemma)", "");
    for (const a of r.aiAnalyses) {
      L.push(`### ${a.task} ${a.commitSha ? `— \`${a.commitSha.slice(0, 7)}\`` : ""} ${a.source === "prerecorded-demo" ? "_(prerecorded demo, not live inference)_" : `_(live: ${a.model})_`}`, "");
      L.push(a.summary, "");
      if (a.observations.length) L.push("**Observations**", "", ...a.observations.map((o) => `- ${o.text}${o.evidenceIds.length ? ` [${o.evidenceIds.join(", ")}]` : ""}`), "");
      if (a.hypotheses.length) L.push("**Hypotheses** (including alternatives)", "", ...a.hypotheses.map((h) => `- **${h.title}** (${h.confidence} confidence): ${h.explanation}${h.evidenceIds.length ? ` [${h.evidenceIds.join(", ")}]` : ""}`), "");
      if (a.suggestedTests.length) {
        L.push("**Suggested tests**", "");
        for (const t of a.suggestedTests) L.push(`- **${t.name}**: ${t.description}`, ...(t.code ? ["", "```ts", t.code, "```"] : []));
        L.push("");
      }
      if (a.uncertaintyNotes.length) L.push("**Uncertainty**", "", ...a.uncertaintyNotes.map((u) => `- ${u}`), "");
    }
  }
  if (r.patches.length) {
    L.push("## Proposed Fixes", "");
    for (const p of r.patches) {
      L.push(`### ${p.title} (${p.strategy}) — ${p.verified ? "verified" : "UNVERIFIED"}`, "", p.description, "", `Rationale: ${p.rationale}`, "", "```diff", p.patch.trimEnd(), "```", "");
    }
  }
  if (r.modifiedFiles.length) L.push("## Modified Files", "", ...r.modifiedFiles.map((f) => `- ${f}`), "");
  if (r.affectedFunctions.length) L.push("## Potentially Affected Functions", "", ...r.affectedFunctions.map((f) => `- ${f}`), "");
  L.push("## Limitations", "", ...r.limitations.map((l) => `- ${l}`), "");
  L.push("---", "_Generated by CODE ZERO — Find Patient Zero in Your Codebase._", "");
  return L.join("\n");
}
