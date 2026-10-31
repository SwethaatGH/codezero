import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env } from "./config";
import { openDatabase, type DB } from "./db";
import { registerErrorHandler } from "./errors";
import { registerAIRoutes } from "./routes/ai";
import { registerInvestigationRoutes } from "./routes/investigations";
import { registerSystemRoutes } from "./routes/system";

export async function buildApp(opts: { db?: DB; logger?: boolean; demoPacingMs?: number } = {}) {
  const db = opts.db ?? openDatabase(env.databasePath);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: [env.corsOrigin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  registerErrorHandler(app, { spaFallback: !!env.webDistPath });
  registerSystemRoutes(app, db);
  registerInvestigationRoutes(app, db, { demoPacingMs: opts.demoPacingMs });
  registerAIRoutes(app, db);
  if (env.webDistPath) await app.register(fastifyStatic, { root: env.webDistPath, wildcard: false });
  app.addHook("onClose", async () => db.close());
  return { app, db };
}
