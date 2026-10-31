import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReportSchema } from "@code-zero/shared";
import { buildReport, reportToMarkdown } from "@code-zero/analysis";
import { env } from "../config";
import type { DB } from "../db";
import { ApiError, notFound } from "../errors";
import { invalidateAIStatus } from "../ai/provider";
import { createOctokit } from "../sources";

const settingsSchema = z.object({
  aiProvider: z.enum(["ollama", "gemini"]).optional(),
  ollamaBaseUrl: z.string().url().optional(),
  ollamaModel: z.string().trim().min(1).max(120).optional(),
  geminiModel: z.string().trim().min(1).max(120).optional(),
  defaultCommitLimit: z.number().int().min(1).max(100).optional(),
  defaultMode: z.enum(["quick-scan", "regression-hunt", "single-commit", "exploration", "ai-guided"]).optional(),
});

/** Writes a public visitor must not make: changing server settings (incl. the Ollama URL it fetches) or wiping all data. */
const PUBLIC_DEMO_LOCKED = new Set(["PUT /api/settings", "POST /api/settings/reset", "POST /api/data/clear"]);

export function registerSystemRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/health", async () => ({ ok: true, version: "0.1.0", time: new Date().toISOString(), publicDemo: env.publicDemo }));
  app.addHook("preHandler", async (req) => {
    if (env.publicDemo && PUBLIC_DEMO_LOCKED.has(`${req.method} ${req.routeOptions.url}`)) {
      throw new ApiError(403, "PUBLIC_DEMO", "Settings and data clearing are disabled on this public demo. Run CODE ZERO locally to change them.");
    }
  });

  app.get("/api/settings", async () => ({ ...db.getSettings(), githubTokenConfigured: !!env.githubToken, geminiKeyConfigured: !!env.geminiApiKey }));
  app.put("/api/settings", async (req) => {
    db.saveSettings(settingsSchema.parse(req.body));
    invalidateAIStatus();
    return db.getSettings();
  });
  app.post("/api/settings/reset", async () => {
    db.resetSettings();
    invalidateAIStatus();
    return db.getSettings();
  });

  app.get("/api/github/status", async () => {
    try {
      const { data } = await createOctokit().rateLimit.get();
      return { reachable: true, authenticated: !!env.githubToken, limit: data.rate.limit, remaining: data.rate.remaining, reset: new Date(data.rate.reset * 1000).toISOString() };
    } catch (err) {
      return { reachable: false, authenticated: !!env.githubToken, limit: null, remaining: null, reset: null, message: (err as Error).message };
    }
  });

  app.post("/api/data/clear", async (req) => {
    const { confirm, scope } = z.object({ confirm: z.literal("DELETE"), scope: z.enum(["all", "cache"]) }).parse(req.body);
    void confirm;
    if (scope === "cache") return { cleared: db.clearCache() };
    db.clearAll();
    return { cleared: true };
  });

  // ── Reports ──
  app.post("/api/reports", async (req, reply) => {
    const { investigationId } = createReportSchema.parse(req.body);
    const inv = db.getInvestigation(investigationId);
    if (!inv) throw notFound("Investigation");
    const repo = db.getRepository(inv.repositoryId);
    if (!repo) throw notFound("Repository");
    const report = buildReport({
      id: `rep_${randomUUID().slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      investigation: inv,
      repository: repo,
      analysis: db.getAnalysis(inv.id),
      aiAnalyses: db.listAI(inv.id),
      patches: db.listPatches(inv.id),
    });
    db.saveReport(report);
    db.saveInvestigation({ ...inv, reportIds: [...inv.reportIds, report.id], updatedAt: new Date().toISOString() });
    return reply.status(201).send(report);
  });
  app.get<{ Querystring: { investigationId?: string } }>("/api/reports", async (req) => db.listReports(req.query.investigationId));
  app.get<{ Params: { id: string } }>("/api/reports/:id", async (req) => {
    const r = db.getReport(req.params.id);
    if (!r) throw notFound("Report");
    return r;
  });
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>("/api/reports/:id/export", async (req, reply) => {
    const r = db.getReport(req.params.id);
    if (!r) throw notFound("Report");
    const format = req.query.format ?? "markdown";
    const base = `code-zero-${r.investigationId}-${r.id}`;
    if (format === "json") {
      return reply.header("content-type", "application/json").header("content-disposition", `attachment; filename="${base}.json"`).send(JSON.stringify(r, null, 2));
    }
    if (format === "markdown" || format === "md") {
      return reply.header("content-type", "text/markdown; charset=utf-8").header("content-disposition", `attachment; filename="${base}.md"`).send(reportToMarkdown(r));
    }
    throw new ApiError(400, "INVALID_FORMAT", "format must be markdown or json");
  });
}
