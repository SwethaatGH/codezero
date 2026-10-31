import type {
  AIAnalysis,
  AIStatus,
  AITask,
  BlastRadius,
  Branch,
  CompareResult,
  CreateInvestigationInput,
  DependencyGraph,
  ExplanationLevel,
  FileContents,
  Investigation,
  InvestigationReport,
  PatchSuggestion,
  ProgressEvent,
  RegressionFinding,
  Repository,
  RepositoryHealth,
  BisectResult,
  Commit,
  RiskAssessment,
  VerificationResult,
} from "@code-zero/shared";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
    });
  } catch (err) {
    throw new ApiRequestError(0, "NETWORK", `Cannot reach the CODE ZERO API (${(err as Error).message}). Is the backend running on port 8787?`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new ApiRequestError(res.status, "HTTP_ERROR", text.slice(0, 200) || `HTTP ${res.status}`);
    return text as T;
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiRequestError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export interface Settings {
  aiProvider: "ollama" | "gemini";
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  defaultCommitLimit: number;
  defaultMode: Investigation["mode"];
  githubTokenConfigured?: boolean;
  geminiKeyConfigured?: boolean;
}

export interface SearchResults {
  investigations: { id: string; name: string; repo: string; status: string }[];
  commits: { investigationId: string; sha: string; message: string }[];
  files: { investigationId: string; path: string }[];
  functions: { investigationId: string; id: string; name: string; filePath: string }[];
  findings: { investigationId: string; commitSha: string; title: string; score: number }[];
}

export const api = {
  ping: () => request<{ ok: boolean }>("/api/health"),
  aiStatus: (refresh = false) => request<AIStatus>(`/api/ai/status${refresh ? "?refresh=1" : ""}`),
  githubStatus: () => request<{ reachable: boolean; authenticated: boolean; limit: number | null; remaining: number | null; reset: string | null; message?: string }>("/api/github/status"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  resetSettings: () => post<Settings>("/api/settings/reset"),
  clearData: (scope: "all" | "cache") => post<unknown>("/api/data/clear", { confirm: "DELETE", scope }),

  importRepo: (input: string) => post<{ repository: Repository; branches: Branch[] }>("/api/repositories/import", { input }),
  repoCommits: (repoId: string, branch: string, limit = 50) => request<Commit[]>(`/api/repositories/${repoId}/commits?branch=${encodeURIComponent(branch)}&limit=${limit}`),
  repository: (repoId: string) => request<Repository>(`/api/repositories/${repoId}`),
  launchDemo: () => post<Investigation>("/api/demo/launch"),

  investigations: () => request<Investigation[]>("/api/investigations"),
  investigation: (id: string) => request<Investigation>(`/api/investigations/${id}`),
  createInvestigation: (input: CreateInvestigationInput) => post<Investigation>("/api/investigations", input),
  updateInvestigation: (id: string, patch: Partial<Pick<Investigation, "name" | "selectedCommitSha" | "knownGoodSha" | "knownBadSha" | "bookmarks" | "notes">>) =>
    request<Investigation>(`/api/investigations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteInvestigation: (id: string) => request<void>(`/api/investigations/${id}`, { method: "DELETE" }),
  duplicateInvestigation: (id: string) => post<Investigation>(`/api/investigations/${id}/duplicate`),
  analyze: (id: string) => post<{ started: boolean }>(`/api/investigations/${id}/analyze`),
  cancel: (id: string) => post<{ cancelled: boolean }>(`/api/investigations/${id}/cancel`),
  findings: (id: string) => request<{ findings: RegressionFinding[]; bisect: BisectResult | null }>(`/api/investigations/${id}/findings`),
  timeline: (id: string) => request<{ commits: Commit[]; assessments: RiskAssessment[]; bisect: BisectResult | null }>(`/api/investigations/${id}/timeline`),
  impact: (id: string, sha: string) => request<{ graph: DependencyGraph | null; blastRadius: BlastRadius }>(`/api/investigations/${id}/impact?sha=${sha}`),
  health: (id: string) => request<RepositoryHealth | null>(`/api/investigations/${id}/health`),
  compare: (investigationId: string, base: string, head: string) => post<CompareResult>("/api/compare", { investigationId, base, head }),
  file: (investigationId: string, path: string, ref: string) => post<FileContents>("/api/files", { investigationId, path, ref }),
  search: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),

  aiList: (id: string) => request<AIAnalysis[]>(`/api/investigations/${id}/ai`),
  aiAnalyze: (body: { investigationId: string; task: AITask; commitSha: string | null; compareBase?: string | null; level: ExplanationLevel }, signal?: AbortSignal) =>
    request<AIAnalysis>("/api/ai/analyze", { method: "POST", body: JSON.stringify(body), signal }),
  aiFix: (body: { investigationId: string; commitSha: string; strategy: PatchSuggestion["strategy"] }) => post<PatchSuggestion>("/api/ai/fix", body),
  patches: (id: string) => request<PatchSuggestion[]>(`/api/investigations/${id}/patches`),
  verifyPatch: (id: string, patchId: string) => post<{ patch: PatchSuggestion; result: VerificationResult }>(`/api/investigations/${id}/patches/${patchId}/verify`),

  reports: (investigationId?: string) => request<InvestigationReport[]>(`/api/reports${investigationId ? `?investigationId=${investigationId}` : ""}`),
  report: (id: string) => request<InvestigationReport>(`/api/reports/${id}`),
  createReport: (investigationId: string) => post<InvestigationReport>("/api/reports", { investigationId }),
  exportUrl: (id: string, format: "markdown" | "json") => `/api/reports/${id}/export?format=${format}`,
};

/** Subscribes to an investigation's SSE progress stream. Returns an unsubscribe function. */
export function subscribeProgress(id: string, onEvent: (e: ProgressEvent) => void, onError?: () => void): () => void {
  const es = new EventSource(`/api/investigations/${id}/progress`);
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data) as ProgressEvent;
    onEvent(ev);
    if (ev.type === "done") es.close();
  };
  es.onerror = () => {
    es.close();
    onError?.();
  };
  return () => es.close();
}

export type ChatEvent = { type: "meta"; model: string; contextChars: number } | { type: "token"; text: string } | { type: "done" } | { type: "error"; message: string };

/** Streams a chat completion over SSE (POST). Abort the signal to stop generation. */
export async function streamChat(
  body: { investigationId: string | null; commitSha: string | null; level: ExplanationLevel; messages: { role: "user" | "assistant"; content: string }[] },
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(res.status, j?.error?.code ?? "HTTP_ERROR", j?.error?.message ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (line) onEvent(JSON.parse(line.slice(5)) as ChatEvent);
    }
  }
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
