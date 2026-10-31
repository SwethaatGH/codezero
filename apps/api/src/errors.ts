import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);

export function registerErrorHandler(app: FastifyInstance, opts: { spaFallback?: boolean } = {}) {
  app.setErrorHandler((err: FastifyError | ApiError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), details: err.issues } });
    }
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({ error: { code: (err as FastifyError).code ?? "INTERNAL_ERROR", message: status >= 500 ? `Internal error: ${err.message}` : err.message } });
  });
  app.setNotFoundHandler((req, reply) => {
    // When serving the built web app, client-side routes fall back to index.html; /api stays JSON.
    if (opts.spaFallback && req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` } });
  });
}
