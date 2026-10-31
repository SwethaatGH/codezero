import type { RiskSignalKind } from "@code-zero/shared";

/** Mirrors SIGNAL_WEIGHTS in @code-zero/analysis (kept here so the web bundle doesn't import the TypeScript compiler). */
export const SIGNAL_LABELS: Record<RiskSignalKind, { label: string; max: number; detection: "ast" | "heuristic" | "metadata"; explain: string }> = {
  "removed-validation": { label: "Removed validation or guard", max: 24, detection: "heuristic", explain: "Removed lines that look like if-guards, throws, clamps or validate() calls and whose tokens don't reappear in added lines." },
  "error-handling": { label: "Error-handling change", max: 14, detection: "heuristic", explain: "Added/removed try/catch/throw/reject lines in modified files." },
  "control-flow": { label: "Condition / operator change", max: 14, detection: "heuristic", explain: "Paired lines whose comparison or logical operators changed (e.g. <= → <), or rewritten branch conditions." },
  "critical-path": { label: "Business-critical path", max: 10, detection: "heuristic", explain: "Modified files whose path mentions auth, payment, checkout, pricing, database, etc." },
  "function-modified": { label: "Exported functions modified", max: 12, detection: "ast", explain: "Functions (from the TypeScript AST) whose bodies contain changed lines; exported ones weigh more." },
  "high-fan-in": { label: "Widely depended-upon file", max: 12, detection: "ast", explain: "Changed file is imported by several other files in the dependency graph." },
  "dependency-manifest": { label: "Dependency manifest change", max: 12, detection: "metadata", explain: "package.json, lockfiles, requirements.txt, go.mod… changed." },
  configuration: { label: "Configuration change", max: 8, detection: "metadata", explain: "Config files (.env, *.config.*, YAML, Dockerfile, CI) changed." },
  "large-diff": { label: "Large diff", max: 12, detection: "metadata", explain: "Many changed lines (lockfiles excluded)." },
  "missing-tests": { label: "Source changed without test changes", max: 8, detection: "metadata", explain: "Source files changed but no test files were touched in the same commit." },
  "import-change": { label: "Import changes", max: 6, detection: "heuristic", explain: "Import/require statements added or removed." },
  "test-modified": { label: "Test assertions removed", max: 8, detection: "heuristic", explain: "expect/assert lines deleted from test files." },
  "symptom-match": { label: "Matches reported symptoms", max: 20, detection: "heuristic", explain: "Keywords from the bug description appear in changed paths or diff lines (AI-Guided mode)." },
};
