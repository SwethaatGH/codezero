import Database from "better-sqlite3";
import type {
  AIAnalysis,
  AnalysisResult,
  Investigation,
  InvestigationReport,
  PatchSuggestion,
  Repository,
} from "@code-zero/shared";
import { defaultSettings, type RuntimeSettings } from "./config";

export type DB = ReturnType<typeof openDatabase>;

export function openDatabase(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS investigations (
      id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_results (investigation_id TEXT PRIMARY KEY REFERENCES investigations(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_analyses (id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE, created_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS patches (id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE, created_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE, created_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, expires_at INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const j = <T>(row: { data: string } | undefined): T | null => (row ? (JSON.parse(row.data) as T) : null);
  const now = () => new Date().toISOString();

  return {
    raw: db,
    close: () => db.close(),

    saveRepository(r: Repository) {
      db.prepare("INSERT INTO repositories (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(r.id, JSON.stringify(r), now());
    },
    getRepository: (id: string) => j<Repository>(db.prepare("SELECT data FROM repositories WHERE id = ?").get(id) as { data: string } | undefined),

    saveInvestigation(inv: Investigation) {
      db.prepare(
        `INSERT INTO investigations (id, repository_id, name, status, created_at, updated_at, data) VALUES (@id, @repositoryId, @name, @status, @createdAt, @updatedAt, @data)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, updated_at = excluded.updated_at, data = excluded.data`,
      ).run({ ...inv, data: JSON.stringify(inv) });
    },
    getInvestigation: (id: string) => j<Investigation>(db.prepare("SELECT data FROM investigations WHERE id = ?").get(id) as { data: string } | undefined),
    listInvestigations: () => (db.prepare("SELECT data FROM investigations ORDER BY updated_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Investigation),
    deleteInvestigation: (id: string) => db.prepare("DELETE FROM investigations WHERE id = ?").run(id).changes > 0,

    saveAnalysis(a: AnalysisResult) {
      db.prepare("INSERT INTO analysis_results (investigation_id, data) VALUES (?, ?) ON CONFLICT(investigation_id) DO UPDATE SET data = excluded.data").run(a.investigationId, JSON.stringify(a));
    },
    getAnalysis: (id: string) => j<AnalysisResult>(db.prepare("SELECT data FROM analysis_results WHERE investigation_id = ?").get(id) as { data: string } | undefined),

    saveAI(a: AIAnalysis, investigationId: string) {
      db.prepare("INSERT OR REPLACE INTO ai_analyses (id, investigation_id, created_at, data) VALUES (?, ?, ?, ?)").run(a.id, investigationId, a.createdAt, JSON.stringify(a));
    },
    listAI: (investigationId: string) => (db.prepare("SELECT data FROM ai_analyses WHERE investigation_id = ? ORDER BY created_at DESC").all(investigationId) as { data: string }[]).map((r) => JSON.parse(r.data) as AIAnalysis),

    savePatch(p: PatchSuggestion, investigationId: string) {
      db.prepare("INSERT OR REPLACE INTO patches (id, investigation_id, created_at, data) VALUES (?, ?, ?, ?)").run(p.id, investigationId, now(), JSON.stringify(p));
    },
    getPatch: (id: string) => j<PatchSuggestion>(db.prepare("SELECT data FROM patches WHERE id = ?").get(id) as { data: string } | undefined),
    listPatches: (investigationId: string) => (db.prepare("SELECT data FROM patches WHERE investigation_id = ? ORDER BY created_at DESC").all(investigationId) as { data: string }[]).map((r) => JSON.parse(r.data) as PatchSuggestion),

    saveReport(r: InvestigationReport) {
      db.prepare("INSERT OR REPLACE INTO reports (id, investigation_id, created_at, data) VALUES (?, ?, ?, ?)").run(r.id, r.investigationId, r.createdAt, JSON.stringify(r));
    },
    getReport: (id: string) => j<InvestigationReport>(db.prepare("SELECT data FROM reports WHERE id = ?").get(id) as { data: string } | undefined),
    listReports: (investigationId?: string) =>
      (investigationId
        ? (db.prepare("SELECT data FROM reports WHERE investigation_id = ? ORDER BY created_at DESC").all(investigationId) as { data: string }[])
        : (db.prepare("SELECT data FROM reports ORDER BY created_at DESC").all() as { data: string }[])
      ).map((r) => JSON.parse(r.data) as InvestigationReport),

    cacheGet<T>(key: string): T | null {
      const row = db.prepare("SELECT data, expires_at FROM http_cache WHERE key = ?").get(key) as { data: string; expires_at: number | null } | undefined;
      if (!row) return null;
      if (row.expires_at !== null && row.expires_at < Date.now()) return null;
      return JSON.parse(row.data) as T;
    },
    cacheSet(key: string, value: unknown, ttlMs: number | null) {
      db.prepare("INSERT OR REPLACE INTO http_cache (key, expires_at, data) VALUES (?, ?, ?)").run(key, ttlMs === null ? null : Date.now() + ttlMs, JSON.stringify(value));
    },
    clearCache: () => db.prepare("DELETE FROM http_cache").run().changes,

    getSettings(): RuntimeSettings {
      const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
      const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
      return { ...defaultSettings, ...stored };
    },
    saveSettings(s: Partial<RuntimeSettings>) {
      const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      for (const [k, v] of Object.entries(s)) if (v !== undefined) stmt.run(k, JSON.stringify(v));
    },
    resetSettings: () => db.prepare("DELETE FROM settings").run(),

    clearAll() {
      db.exec("DELETE FROM reports; DELETE FROM patches; DELETE FROM ai_analyses; DELETE FROM analysis_results; DELETE FROM investigations; DELETE FROM repositories; DELETE FROM http_cache;");
    },
  };
}
