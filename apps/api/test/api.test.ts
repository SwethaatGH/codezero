import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AIAnalysis, Investigation, InvestigationReport, PatchSuggestion } from "@code-zero/shared";
import { buildApp } from "../src/app";
import { openDatabase } from "../src/db";
import { invalidateAIStatus } from "../src/ai/provider";
import { defaultSettings } from "../src/config";

let ctx: Awaited<ReturnType<typeof buildApp>>;
const realFetch = globalThis.fetch;

async function waitForCompletion(id: string): Promise<Investigation> {
  for (let i = 0; i < 200; i++) {
    const r = await ctx.app.inject({ method: "GET", url: `/api/investigations/${id}` });
    const inv = r.json() as Investigation;
    if (inv.status !== "running" && inv.status !== "created") return inv;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout");
}

/** Mock Ollama: tags list includes the model; chat returns schema-valid JSON citing a real and a fake evidence id. */
function mockOllama(available: boolean) {
  invalidateAIStatus();
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("11434")) return realFetch(url, init);
    if (!available) throw new TypeError("fetch failed");
    if (u.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: defaultSettings.ollamaModel }] }));
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const userText = body.messages.map((m) => m.content).join("\n");
    const realId = /\[([0-9a-f]{7}-\d+)\]/.exec(userText)?.[1] ?? "none";
    const content = JSON.stringify({
      summary: "Guard removal in applyDiscount.",
      observations: [{ text: "Removed cap", evidenceIds: [realId, "invented-99"] }],
      hypotheses: [{ title: "Uncapped stacking", explanation: "Sum exceeds 100%", confidence: "high", evidenceIds: [realId] }],
      riskExplanation: "High",
      suggestedTests: [],
      recommendedActions: [],
      uncertaintyNotes: [],
    });
    return new Response(JSON.stringify({ message: { content } }));
  }) as typeof fetch;
}

beforeAll(async () => {
  ctx = await buildApp({ db: openDatabase(":memory:"), demoPacingMs: 0 });
  // Hermetic: always use the mocked Ollama endpoint, regardless of the developer's .env.
  ctx.db.saveSettings({ aiProvider: "ollama", ollamaBaseUrl: "http://localhost:11434" });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await ctx.app.close();
});

describe("API", () => {
  it("validates repository input", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/repositories/import", payload: { input: "not a repo" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_REPOSITORY_INPUT");
  });

  it("imports the demo repository", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/repositories/import", payload: { input: "demo" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().repository.isDemo).toBe(true);
  });

  it("rejects invalid investigations with a consistent error body", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/investigations", payload: { repositoryId: "demo/orbit-checkout", branch: "main", mode: "regression-hunt" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION_ERROR");
  });

  let invId = "";
  it("creates and analyzes an investigation end to end", async () => {
    mockOllama(false);
    const r = await ctx.app.inject({ method: "POST", url: "/api/demo/launch" });
    invId = (r.json() as Investigation).id;
    const inv = await waitForCompletion(invId);
    expect(inv.status).toBe("completed");
    expect(inv.findings[0].status).toBe("test-confirmed");
    expect(inv.findings[0].title).toMatch(/Refactor discount stacking/);
    expect(inv.progress.stages.find((s) => s.stage === "ai-context")!.status).toBe("done");
    const tl = await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}/timeline` });
    expect(tl.json().commits).toHaveLength(11);
  });

  it("computes impact for the suspected commit", async () => {
    const inv = (await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}` })).json() as Investigation;
    const r = await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}/impact?sha=${inv.findings[0].commitSha}` });
    expect(r.json().blastRadius.affected.map((a: { id: string }) => a.id)).toContain("fn:src/checkout.ts#checkout");
  });

  it("compares two commits", async () => {
    const tl = (await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}/timeline` })).json();
    const chrono = [...tl.commits].reverse();
    const r = await ctx.app.inject({ method: "POST", url: "/api/compare", payload: { investigationId: invId, base: chrono[4].sha, head: chrono[6].sha } });
    const body = r.json();
    expect(body.files.map((f: { path: string }) => f.path)).toEqual(["package.json", "src/discounts.ts"]);
    expect(body.dependencyChanges[0].changed).toContain("zod: ^3.22.0 → ^3.24.1");
    expect(body.functionChanges).toContainEqual({ filePath: "src/discounts.ts", name: "stackPercents", change: "added" });
    expect(body.functionChanges).toContainEqual({ filePath: "src/discounts.ts", name: "applyDiscount", change: "modified" });
  });

  it("falls back to labeled prerecorded analysis when Gemma is unavailable", async () => {
    mockOllama(false);
    const inv = (await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}` })).json() as Investigation;
    const r = await ctx.app.inject({ method: "POST", url: "/api/ai/analyze", payload: { investigationId: invId, task: "root-cause", commitSha: inv.findings[0].commitSha } });
    const a = r.json() as AIAnalysis;
    expect(a.source).toBe("prerecorded-demo");
    expect(a.model).toBeNull();
    expect(a.unknownEvidenceIds).toEqual([]);
  });

  it("validates live AI output and strips unknown evidence ids (mocked inference)", async () => {
    mockOllama(true);
    const inv = (await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}` })).json() as Investigation;
    const r = await ctx.app.inject({ method: "POST", url: "/api/ai/analyze", payload: { investigationId: invId, task: "root-cause", commitSha: inv.findings[0].commitSha } });
    const a = r.json() as AIAnalysis;
    expect(r.statusCode).toBe(200);
    expect(a.source).toBe("live");
    expect(a.unknownEvidenceIds).toEqual(["invented-99"]);
    expect(a.observations[0].evidenceIds).not.toContain("invented-99");
    expect(a.evidence.length).toBeGreaterThan(0);
  });

  it("generates and verifies a treatment for the demo", async () => {
    mockOllama(false);
    const inv = (await ctx.app.inject({ method: "GET", url: `/api/investigations/${invId}` })).json() as Investigation;
    const sha = inv.findings[0].commitSha;
    const revert = (await ctx.app.inject({ method: "POST", url: "/api/ai/fix", payload: { investigationId: invId, commitSha: sha, strategy: "revert" } })).json() as PatchSuggestion;
    expect(revert.patchValid).toBe(true);
    expect(revert.verified).toBe(false);
    const v = await ctx.app.inject({ method: "POST", url: `/api/investigations/${invId}/patches/${revert.id}/verify` });
    expect(v.json().patch.verified).toBe(true);
    const minimal = (await ctx.app.inject({ method: "POST", url: "/api/ai/fix", payload: { investigationId: invId, commitSha: sha, strategy: "minimal" } })).json() as PatchSuggestion;
    expect(minimal.patchValid).toBe(true);
    const v2 = await ctx.app.inject({ method: "POST", url: `/api/investigations/${invId}/patches/${minimal.id}/verify` });
    expect(v2.json().result.results.every((t: { passed: boolean }) => t.passed)).toBe(true);
  });

  it("persists and exports reports", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/reports", payload: { investigationId: invId } });
    expect(r.statusCode).toBe(201);
    const rep = r.json() as InvestigationReport;
    expect(rep.complete).toBe(true);
    expect(rep.patches.length).toBeGreaterThan(0);
    const md = await ctx.app.inject({ method: "GET", url: `/api/reports/${rep.id}/export?format=markdown` });
    expect(md.headers["content-type"]).toContain("text/markdown");
    expect(md.body).toContain("SIMULATED DEMO DATA");
    const again = await ctx.app.inject({ method: "GET", url: `/api/reports/${rep.id}` });
    expect(again.json().id).toBe(rep.id);
  });

  it("renames, duplicates and deletes investigations", async () => {
    const ren = await ctx.app.inject({ method: "PATCH", url: `/api/investigations/${invId}`, payload: { name: "Renamed" } });
    expect(ren.json().name).toBe("Renamed");
    const dup = await ctx.app.inject({ method: "POST", url: `/api/investigations/${invId}/duplicate` });
    expect(dup.statusCode).toBe(201);
    const del = await ctx.app.inject({ method: "DELETE", url: `/api/investigations/${dup.json().id}` });
    expect(del.statusCode).toBe(204);
    const missing = await ctx.app.inject({ method: "GET", url: `/api/investigations/${dup.json().id}` });
    expect(missing.statusCode).toBe(404);
  });
});
