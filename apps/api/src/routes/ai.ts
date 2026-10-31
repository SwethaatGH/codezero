import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { aiAnalyzeSchema, aiChatSchema, aiFixSchema } from "@code-zero/shared";
import type { DB } from "../db";
import { ApiError } from "../errors";
import { buildContext, chatSystemPrompt } from "../ai/context";
import { checkAIStatus, invalidateAIStatus, streamChat } from "../ai/provider";
import { generateFix, loadInvestigationBundle, runAnalysis, verifyPatch } from "../ai/service";

/**
 * Abort controller tied to the client connection, so "Stop generation" cancels inference.
 * Listens on the response: the request's "close" fires as soon as its body has been read.
 */
function connectionSignal(res: { on: (e: "close", cb: () => void) => void; writableFinished: boolean }) {
  const c = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) c.abort();
  });
  return c.signal;
}

export function registerAIRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { refresh?: string } }>("/api/ai/status", async (req) => checkAIStatus(db.getSettings(), req.query.refresh === "1"));

  app.post("/api/ai/analyze", async (req, reply) => runAnalysis(db, aiAnalyzeSchema.parse(req.body), connectionSignal(reply.raw)));

  app.post("/api/ai/tests", async (req, reply) => {
    const body = aiAnalyzeSchema.omit({ task: true }).parse(req.body);
    return runAnalysis(db, { ...body, task: "tests" }, connectionSignal(reply.raw));
  });

  app.post("/api/ai/fix", async (req, reply) => generateFix(db, aiFixSchema.parse(req.body), connectionSignal(reply.raw)));

  app.get<{ Params: { id: string } }>("/api/investigations/:id/ai", async (req) => db.listAI(req.params.id));
  app.get<{ Params: { id: string } }>("/api/investigations/:id/patches", async (req) => db.listPatches(req.params.id));
  app.post<{ Params: { id: string; patchId: string } }>("/api/investigations/:id/patches/:patchId/verify", async (req) => verifyPatch(db, req.params.id, req.params.patchId));

  app.post("/api/ai/chat", async (req, reply) => {
    const body = aiChatSchema.parse(req.body);
    const settings = db.getSettings();
    const status = await checkAIStatus(settings, false);
    if (status.state !== "connected") {
      invalidateAIStatus();
      throw new ApiError(503, "AI_UNAVAILABLE", `Live chat needs Gemma. ${status.message}`);
    }
    let context: string | null = null;
    if (body.investigationId) {
      const { inv, analysis, repo } = loadInvestigationBundle(db, body.investigationId);
      context = buildContext({ repo, inv, analysis, commitSha: body.commitSha ?? inv.selectedCommitSha }).text;
    }
    const signal = connectionSignal(reply.raw);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": (req.headers.origin as string) ?? "*" });
    const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ type: "meta", model: status.model, contextChars: context?.length ?? 0 });
    try {
      for await (const token of streamChat(settings, [{ role: "system", content: chatSystemPrompt(body.level, context) }, ...body.messages], signal)) send({ type: "token", text: token });
      send({ type: "done" });
    } catch (err) {
      if (!signal.aborted) send({ type: "error", message: `Gemma inference failed: ${(err as Error).message}` });
    } finally {
      res.end();
    }
  });

  app.get("/api/ai/tasks", async () => z.enum(["root-cause", "semantic-diff", "impact", "tests", "fix", "alternatives", "commit-investigation"]).options);
}
