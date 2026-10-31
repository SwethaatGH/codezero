import { config as loadEnv } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (apps/api/src → ../../..). The root .env is shared by all apps. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(REPO_ROOT, ".env"), quiet: true } as Parameters<typeof loadEnv>[0]);

const dbPath = process.env.DATABASE_PATH ?? "./code-zero.db";

export type AIProvider = "ollama" | "gemini";

export interface RuntimeSettings {
  aiProvider: AIProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  defaultCommitLimit: number;
  defaultMode: "quick-scan" | "regression-hunt" | "single-commit" | "exploration" | "ai-guided";
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "127.0.0.1",
  databasePath: dbPath === ":memory:" || isAbsolute(dbPath) ? dbPath : resolve(REPO_ROOT, dbPath),
  githubToken: process.env.GITHUB_TOKEN || null,
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  maxGraphFiles: Number(process.env.MAX_GRAPH_FILES ?? 250),
  maxParseFilesPerCommit: Number(process.env.MAX_PARSE_FILES_PER_COMMIT ?? 8),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 300_000),
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 120_000),
  /** Built web app to serve from the API (single-server deploys). Unset in dev, where Vite serves it. */
  webDistPath: process.env.WEB_DIST_PATH ? resolve(REPO_ROOT, process.env.WEB_DIST_PATH) : null,
  /** Public deployments: settings and data-clearing endpoints are read-only so visitors cannot change or wipe the server. */
  publicDemo: process.env.PUBLIC_DEMO === "true",
};

export const defaultSettings: RuntimeSettings = {
  aiProvider: (process.env.AI_PROVIDER as AIProvider) === "gemini" ? "gemini" : "ollama",
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL ?? "gemma4",
  geminiModel: process.env.GEMINI_MODEL ?? "gemma-4-26b-a4b-it",
  defaultCommitLimit: 20,
  defaultMode: "quick-scan",
};
