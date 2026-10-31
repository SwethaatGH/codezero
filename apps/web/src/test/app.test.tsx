import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Commit, Investigation, RiskAssessment } from "@code-zero/shared";
import { AppRoutes, createQueryClient } from "../App";
import { useSelection } from "../lib/selection";
import { useUI } from "../lib/store";
import { CommitDrawer } from "../components/investigation";

const now = new Date().toISOString();
function makeInv(over: Partial<Investigation> = {}): Investigation {
  return {
    id: "inv_test", name: "Demo · test", repositoryId: "demo/orbit-checkout", repoFullName: "code-zero-demo/orbit-checkout", branch: "main", mode: "quick-scan",
    status: "running", isDemo: true, params: { limit: 20, since: null, until: null, goodSha: null, badSha: null, commitSha: null, symptoms: null },
    createdAt: now, updatedAt: now, commitRange: { from: null, to: null, count: 0 }, selectedCommitSha: null, knownGoodSha: null, knownBadSha: null,
    findings: [], notes: [], bookmarks: [], progress: { stages: [{ stage: "connect", label: "Loading simulated demo repository", status: "running", detail: null }], percent: 10, logs: [] }, error: null, reportIds: [], ...over,
  };
}

type Handler = (url: string, init?: RequestInit) => unknown;
function mockFetch(routes: Record<string, Handler>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `unmocked ${url}` } }), { status: 404 });
    const body = routes[key](url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

function renderApp(path: string) {
  let loc = "";
  function Spy() {
    loc = useLocation().pathname + useLocation().search;
    return null;
  }
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Spy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { location: () => loc };
}

beforeEach(() => {
  useUI.setState({ lastInvestigationId: null, notifications: [], commandOpen: false });
  vi.stubGlobal("fetch", mockFetch({
    "/api/ai/status": () => ({ state: "unavailable", baseUrl: "", model: "gemma4", availableModels: [], message: "Cannot reach Ollama" }),
    "/api/investigations": () => [],
    "/api/settings": () => ({ aiProvider: "ollama", ollamaBaseUrl: "http://localhost:11434", ollamaModel: "gemma4", geminiModel: "x", defaultCommitLimit: 20, defaultMode: "quick-scan" }),
  }));
});

describe("Navigation", () => {
  it("shows the welcome screen without an investigation and navigates via the sidebar", async () => {
    const app = renderApp("/");
    expect(await screen.findByText(/Find/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: /Time Portal/ })[0]);
    expect(await screen.findByRole("heading", { name: "Time Portal" })).toBeInTheDocument();
    expect(app.location()).toBe("/portal");
  });

  it("gates diagnostic modules until an investigation exists", async () => {
    renderApp("/timeline");
    expect(await screen.findByText("No patient under investigation")).toBeInTheDocument();
  });
});

describe("Repository import form", () => {
  it("surfaces backend validation errors", async () => {
    vi.stubGlobal("fetch", mockFetch({
      "/api/repositories/import": () => new Response(JSON.stringify({ error: { code: "INVALID_REPOSITORY_INPUT", message: "Enter a GitHub URL (https://github.com/owner/repo) or owner/repo." } }), { status: 400 }),
      "/api/ai/status": () => ({ state: "unavailable", baseUrl: "", model: "", availableModels: [], message: "" }),
      "/api/investigations": () => [],
      "/api/settings": () => ({ defaultCommitLimit: 20, defaultMode: "quick-scan" }),
    }));
    renderApp("/portal");
    fireEvent.change(await screen.findByLabelText("Repository", { selector: "input" }), { target: { value: "not a repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch metadata" }));
    expect(await screen.findByText(/Enter a GitHub URL/)).toBeInTheDocument();
  });
});

describe("Demo mode", () => {
  it("launches the demo and opens Mission Control with the investigation in the URL", async () => {
    const fetchMock = mockFetch({
      "/api/demo/launch": () => makeInv(),
      "/api/investigations/inv_test": () => makeInv(),
      "/api/investigations": () => [makeInv()],
      "/api/ai/status": () => ({ state: "unavailable", baseUrl: "", model: "", availableModels: [], message: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = renderApp("/mission");
    fireEvent.click((await screen.findAllByRole("button", { name: /Launch Demo Investigation/ }))[0]);
    await waitFor(() => expect(app.location()).toContain("inv=inv_test"));
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes("/api/demo/launch") && i?.method === "POST")).toBe(true);
    expect(await screen.findByText("Analysis pipeline")).toBeInTheDocument();
    expect((await screen.findAllByText(/SIMULATED/)).length).toBeGreaterThan(0);
  });
});

describe("Investigation state synchronization", () => {
  function Harness() {
    const sel = useSelection();
    const loc = useLocation();
    return (
      <div>
        <div data-testid="loc">{loc.pathname + loc.search}</div>
        <button onClick={() => sel.selectCommit("abc1234")}>select</button>
        <button onClick={() => sel.setCompare("aaa1111", "bbb2222")}>compare</button>
        <button onClick={() => sel.go("/infection")}>go</button>
      </div>
    );
  }
  it("keeps investigation, selected commit and comparison in the URL across modules", () => {
    render(
      <MemoryRouter initialEntries={["/timeline?inv=inv_x"]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("select"));
    expect(screen.getByTestId("loc").textContent).toContain("commit=abc1234");
    fireEvent.click(screen.getByText("compare"));
    fireEvent.click(screen.getByText("go"));
    const loc = screen.getByTestId("loc").textContent!;
    expect(loc.startsWith("/infection?")).toBe(true);
    expect(loc).toContain("inv=inv_x");
    expect(loc).toContain("commit=abc1234");
    expect(loc).toContain("a=aaa1111");
    expect(loc).toContain("b=bbb2222");
    expect(useUI.getState().lastInvestigationId).toBe("inv_x");
  });
});

describe("Timeline selection drawer", () => {
  const commit: Commit = {
    sha: "37f753c7c58be41e9d140f703d3328f4ffb8b0e9", shortSha: "37f753c", message: "Refactor discount stacking", author: { name: "Dev Patel", email: null, login: null, avatarUrl: null },
    date: now, parents: ["1dc0277aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], stats: { additions: 8, deletions: 10, total: 18 },
    files: [{ path: "src/discounts.ts", previousPath: null, status: "modified", additions: 8, deletions: 10, patch: "@@ -1,2 +1,2 @@\n-const capped = Math.min(percent, 60);\n+const percent = stack();", binary: false, truncated: false }],
    url: null,
  };
  const assessment: RiskAssessment = {
    commitSha: commit.sha, score: 81, level: "high", modifiedFunctions: [], importChanges: [], skippedFiles: [],
    signals: [{ id: "s1", kind: "removed-validation", label: "Removed validation or guard", weight: 24, detection: "heuristic", description: "Removed guard", evidence: [{ id: "37f753c-1", kind: "diff-line", commitSha: commit.sha, filePath: "src/discounts.ts", line: 1, snippet: "const capped = Math.min(percent, 60);", description: "Removed guard-like line" }] }],
  };
  it("shows commit metadata, risk factors with detection labels, and diffs on demand", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <CommitDrawer inv={makeInv({ status: "completed" })} commit={commit} assessment={assessment} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Refactor discount stacking")).toBeInTheDocument();
    expect(screen.getByText("Heuristic")).toBeInTheDocument();
    expect(screen.getByText("+24")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByText("src/discounts.ts")));
    expect(screen.getByText("+const percent = stack();")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Removed validation or guard"));
    expect(screen.getByText("37f753c-1")).toBeInTheDocument();
  });
});
