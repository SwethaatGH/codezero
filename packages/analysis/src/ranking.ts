import type { BisectResult, Commit, RegressionFinding, RiskAssessment, RiskSignal } from "@code-zero/shared";

const STEP_FOR_SIGNAL: Partial<Record<RiskSignal["kind"], (s: RiskSignal) => string>> = {
  "removed-validation": (s) => `Write a test that exercises the removed guard(s) in ${files(s)} with invalid / boundary input and compare behavior before and after.`,
  "control-flow": (s) => `Add boundary-value tests around the changed condition(s) in ${files(s)} (values just below, at, and above each threshold).`,
  "error-handling": (s) => `Trigger the failure path in ${files(s)} and confirm errors are still raised or reported as expected.`,
  "dependency-manifest": () => "Diff the resolved dependency versions and review changelogs for breaking changes; run the suite against both lockfiles.",
  configuration: (s) => `Compare runtime configuration before/after for ${files(s)} in each environment that reads it.`,
  "missing-tests": () => "No tests changed alongside this code: add a regression test that pins the intended behavior.",
  "high-fan-in": () => "Run the tests for every dependent module listed in the Blast Radius panel.",
  "symptom-match": () => "Reproduce the reported symptom at the parent commit and at this commit to see whether behavior differs.",
};

function files(s: RiskSignal): string {
  const f = [...new Set(s.evidence.map((e) => e.filePath).filter(Boolean))];
  return f.length ? f.slice(0, 3).join(", ") : "the changed files";
}

export function firstLine(message: string): string {
  return message.split("\n")[0].trim();
}

/** Ranks commits by heuristic score and produces traceable findings for the top candidates. */
export function rankSuspects(
  commits: Commit[],
  assessments: RiskAssessment[],
  opts: { top?: number; bisect?: BisectResult | null } = {},
): RegressionFinding[] {
  const top = opts.top ?? 5;
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const order = new Map(commits.map((c, i) => [c.sha, i]));
  const ranked = assessments
    .filter((a) => a.score > 0 && bySha.has(a.commitSha))
    .sort((a, b) => b.score - a.score || (order.get(a.commitSha)! - order.get(b.commitSha)!));

  // A test-confirmed first-bad commit is always surfaced first.
  const confirmed = opts.bisect?.firstBadSha ?? null;
  if (confirmed) {
    const idx = ranked.findIndex((a) => a.commitSha === confirmed);
    if (idx > 0) ranked.unshift(...ranked.splice(idx, 1));
  }

  return ranked.slice(0, top).map((a, i) => {
    const commit = bySha.get(a.commitSha)!;
    const status: RegressionFinding["status"] =
      confirmed === a.commitSha ? "test-confirmed" : a.score >= 40 ? "suspected" : a.score >= 15 ? "unverified-hypothesis" : "insufficient-evidence";
    const steps = a.signals.map((s) => STEP_FOR_SIGNAL[s.kind]?.(s)).filter((x): x is string => !!x);
    steps.push(`Check out ${commit.shortSha}^ (parent) and ${commit.shortSha}, run the relevant tests on both, and compare results.`);
    return {
      id: `finding:${a.commitSha}`,
      commitSha: a.commitSha,
      rank: i + 1,
      score: a.score,
      status,
      title: firstLine(commit.message),
      relevantFiles: [...new Set(a.signals.flatMap((s) => s.evidence.map((e) => e.filePath)).filter((p): p is string => !!p))].slice(0, 10),
      signalIds: a.signals.map((s) => s.id),
      evidence: a.signals.flatMap((s) => s.evidence).slice(0, 25),
      verificationSteps: [...new Set(steps)],
    };
  });
}
