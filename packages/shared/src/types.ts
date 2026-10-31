// Core domain model for CODE ZERO.
// Unknown values are represented as `null` rather than invented defaults.

export type ISODate = string;

export interface Repository {
  id: string; // "owner/name" for GitHub, "demo/<name>" for demo
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  primaryLanguage: string | null;
  languages: Record<string, number> | null;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  defaultBranch: string;
  htmlUrl: string | null;
  contributorsCount: number | null;
  latestCommitSha: string | null;
  isDemo: boolean;
  importedAt: ISODate;
}

export interface Branch {
  name: string;
  sha: string;
  protected: boolean | null;
}

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunk text (no file headers). Null for binary or truncated files. */
  patch: string | null;
  binary: boolean;
  truncated: boolean;
}

export interface CommitAuthor {
  name: string;
  email: string | null;
  login: string | null;
  avatarUrl: string | null;
}

export interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  author: CommitAuthor;
  date: ISODate;
  parents: string[];
  stats: { additions: number; deletions: number; total: number } | null;
  files: ChangedFile[];
  url: string | null;
}

export type FunctionKind = "function" | "method" | "arrow" | "class";

export interface CodeFunction {
  id: string; // `${filePath}#${name}`
  name: string;
  kind: FunctionKind;
  filePath: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export type EvidenceKind = "diff-line" | "file" | "commit" | "ast" | "import" | "manifest" | "test-result" | "metadata";

export interface EvidenceReference {
  id: string;
  kind: EvidenceKind;
  commitSha: string | null;
  filePath: string | null;
  line: number | null;
  snippet: string | null;
  description: string;
}

export type DependencyNodeKind = "module" | "file" | "function" | "class";

export interface DependencyNode {
  id: string;
  kind: DependencyNodeKind;
  label: string;
  filePath: string | null;
  module: string;
  language: string | null;
  parentId: string | null;
  isTest: boolean;
}

export type DependencyEdgeKind = "import" | "call" | "contains";

export interface DependencyEdge {
  id: string;
  source: string; // dependent (importer / caller)
  target: string; // dependency (imported / callee)
  kind: DependencyEdgeKind;
  evidence: EvidenceReference;
}

export interface DependencyGraph {
  headSha: string | null;
  level: "function" | "file";
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  analyzedFiles: number;
  skippedFiles: { path: string; reason: string }[];
  limitations: string[];
}

export interface AffectedNode {
  id: string;
  depth: number;
  /** "call" = reached through a statically detected call; "import" = reached only through a module import */
  via: "call" | "import";
  pathEdgeIds: string[];
}

export interface BlastRadius {
  commitSha: string | null;
  seeds: string[];
  modifiedFunctions: string[];
  directDependents: string[];
  affected: AffectedNode[];
  relatedTests: string[];
  classification: "contained" | "moderate" | "wide" | "unknown";
  notes: string[];
}

export type RiskSignalKind =
  | "removed-validation"
  | "error-handling"
  | "dependency-manifest"
  | "configuration"
  | "large-diff"
  | "missing-tests"
  | "critical-path"
  | "control-flow"
  | "import-change"
  | "test-modified"
  | "high-fan-in"
  | "symptom-match"
  | "function-modified";

export interface RiskSignal {
  id: string;
  kind: RiskSignalKind;
  label: string;
  weight: number;
  /** How the signal was produced. "heuristic" signals are pattern-based and may be wrong. */
  detection: "ast" | "heuristic" | "metadata";
  description: string;
  evidence: EvidenceReference[];
}

export interface ImportChange {
  filePath: string;
  added: string[];
  removed: string[];
}

export interface RiskAssessment {
  commitSha: string;
  /** Heuristic score 0–100. NOT a calibrated probability of failure. */
  score: number;
  level: "low" | "moderate" | "elevated" | "high";
  signals: RiskSignal[];
  modifiedFunctions: CodeFunction[];
  importChanges: ImportChange[];
  skippedFiles: { path: string; reason: string }[];
}

export type FindingStatus = "suspected" | "test-confirmed" | "unverified-hypothesis" | "insufficient-evidence";

export interface RegressionFinding {
  id: string;
  commitSha: string;
  rank: number;
  score: number;
  status: FindingStatus;
  title: string;
  relevantFiles: string[];
  signalIds: string[];
  evidence: EvidenceReference[];
  verificationSteps: string[];
}

export type InvestigationMode = "quick-scan" | "regression-hunt" | "single-commit" | "exploration" | "ai-guided";

export type InvestigationStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type PipelineStage =
  | "connect"
  | "metadata"
  | "commits"
  | "diffs"
  | "parse"
  | "dependencies"
  | "risk"
  | "ai-context";

export interface StageState {
  stage: PipelineStage;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail: string | null;
}

export interface AnalysisLogEntry {
  at: ISODate;
  level: "info" | "warn" | "error";
  message: string;
}

export interface InvestigationProgress {
  stages: StageState[];
  percent: number;
  logs: AnalysisLogEntry[];
}

export interface InvestigationNote {
  id: string;
  text: string;
  commitSha: string | null;
  createdAt: ISODate;
}

export interface CommitBookmark {
  sha: string;
  label: string | null;
  createdAt: ISODate;
}

export interface InvestigationParams {
  limit: number;
  since: ISODate | null;
  until: ISODate | null;
  goodSha: string | null;
  badSha: string | null;
  commitSha: string | null;
  symptoms: string | null;
}

export interface Investigation {
  id: string;
  name: string;
  repositoryId: string;
  repoFullName: string;
  branch: string;
  mode: InvestigationMode;
  status: InvestigationStatus;
  isDemo: boolean;
  params: InvestigationParams;
  createdAt: ISODate;
  updatedAt: ISODate;
  commitRange: { from: string | null; to: string | null; count: number };
  selectedCommitSha: string | null;
  knownGoodSha: string | null;
  knownBadSha: string | null;
  findings: RegressionFinding[];
  notes: InvestigationNote[];
  bookmarks: CommitBookmark[];
  progress: InvestigationProgress;
  error: string | null;
  reportIds: string[];
}

export interface CommitTestResult {
  testName: string;
  passed: boolean;
  message: string | null;
}

export interface VerificationResult {
  id: string;
  commitSha: string;
  method: "demo-harness" | "manual" | "not-run";
  ranAt: ISODate | null;
  results: CommitTestResult[];
  summary: string;
}

export interface BisectResult {
  firstBadSha: string | null;
  lastGoodSha: string | null;
  steps: { sha: string; passed: boolean }[];
  verification: VerificationResult[];
}

export interface RepositoryHealth {
  commitActivity: { date: string; commits: number; additions: number; deletions: number }[];
  contributors: { name: string; commits: number; additions: number; deletions: number }[];
  hotspots: { path: string; changes: number; churn: number; avgRisk: number; maxRisk: number }[];
  churnHeatmap: { path: string; byCommit: { sha: string; churn: number }[] }[];
  riskTrend: { sha: string; shortSha: string; date: string; score: number }[];
  languageBreakdown: { language: string; bytes: number }[] | null;
  manifestChanges: { sha: string; path: string }[];
  testChanges: { sha: string; path: string }[];
  configChanges: { sha: string; path: string }[];
  testFileCount: number;
  sourceFileCount: number;
  summary: string[];
}

export interface AnalysisResult {
  investigationId: string;
  commits: Commit[];
  assessments: RiskAssessment[];
  graph: DependencyGraph | null;
  health: RepositoryHealth | null;
  bisect: BisectResult | null;
  generatedAt: ISODate;
}

// ─── AI ──────────────────────────────────────────────────────────────

export type ExplanationLevel = "beginner" | "developer" | "expert";

export type AITask =
  | "root-cause"
  | "semantic-diff"
  | "impact"
  | "tests"
  | "fix"
  | "alternatives"
  | "commit-investigation";

export interface AIHypothesis {
  title: string;
  explanation: string;
  confidence: "low" | "medium" | "high";
  evidenceIds: string[];
}

export interface TestSuggestion {
  name: string;
  description: string;
  targetFile: string | null;
  code: string;
}

export interface PatchSuggestion {
  id: string;
  strategy: "minimal" | "revert" | "preventive";
  title: string;
  description: string;
  targetFiles: string[];
  rationale: string;
  expectedBehavior: string;
  risks: string[];
  verification: string[];
  /** unified diff with ---/+++ headers */
  patch: string;
  original: string | null;
  proposed: string | null;
  verified: boolean;
  patchValid: boolean;
  patchError: string | null;
}

export interface AIAnalysis {
  id: string;
  task: AITask;
  commitSha: string | null;
  level: ExplanationLevel;
  source: "live" | "prerecorded-demo";
  model: string | null;
  createdAt: ISODate;
  summary: string;
  observations: { text: string; evidenceIds: string[] }[];
  hypotheses: AIHypothesis[];
  riskExplanation: string;
  suggestedTests: TestSuggestion[];
  recommendedActions: string[];
  uncertaintyNotes: string[];
  /** evidence ids referenced by the model that were not in the provided context */
  unknownEvidenceIds: string[];
  evidence: EvidenceReference[];
}

export interface AIStatus {
  state: "connected" | "unavailable" | "model-missing" | "error";
  baseUrl: string;
  model: string;
  availableModels: string[];
  message: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── Reports ─────────────────────────────────────────────────────────

export interface InvestigationReport {
  id: string;
  investigationId: string;
  title: string;
  createdAt: ISODate;
  repository: Pick<Repository, "fullName" | "htmlUrl" | "defaultBranch" | "isDemo" | "description">;
  mode: InvestigationMode;
  branch: string;
  commitRange: Investigation["commitRange"];
  symptoms: string | null;
  summary: string[];
  riskIndicators: { label: string; value: string }[];
  suspiciousCommits: {
    sha: string;
    message: string;
    score: number;
    status: FindingStatus;
    signals: { label: string; detection: RiskSignal["detection"]; weight: number }[];
  }[];
  evidence: EvidenceReference[];
  modifiedFiles: string[];
  affectedFunctions: string[];
  aiAnalyses: AIAnalysis[];
  patches: PatchSuggestion[];
  verification: VerificationResult[];
  limitations: string[];
  complete: boolean;
}

// ─── API ─────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export type ProgressEvent =
  | { type: "progress"; progress: InvestigationProgress; status: InvestigationStatus }
  | { type: "done"; status: InvestigationStatus; error: string | null };

export interface CompareResult {
  base: string;
  head: string;
  files: ChangedFile[];
  commits: Pick<Commit, "sha" | "shortSha" | "message" | "date">[];
  totals: { additions: number; deletions: number; files: number };
  dependencyChanges: { path: string; added: string[]; removed: string[]; changed: string[] }[];
  configChanges: string[];
  functionChanges: { filePath: string; name: string; change: "added" | "removed" | "modified" }[];
}

export interface FileContents {
  path: string;
  ref: string;
  content: string | null;
  missing: boolean;
}
