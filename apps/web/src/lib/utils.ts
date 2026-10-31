import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RiskAssessment } from "@code-zero/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "—");
export const firstLine = (s: string) => s.split("\n")[0];

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
// Bare dates (YYYY-MM-DD) are calendar days, not UTC instants — parse them as local dates.
export const fmtDay = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

export type Level = RiskAssessment["level"];
export const LEVEL_COLOR: Record<Level, string> = { low: "#39D98A", moderate: "#40E0D0", elevated: "#FFCB6B", high: "#FF5C7A" };

export function scoreLevel(score: number): Level {
  if (score >= 60) return "high";
  if (score >= 40) return "elevated";
  if (score >= 20) return "moderate";
  return "low";
}
export const scoreColor = (s: number) => LEVEL_COLOR[scoreLevel(s)];

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    json: "json", md: "markdown", py: "python", go: "go", rs: "rust", java: "java", rb: "ruby", php: "php", css: "css", scss: "scss",
    html: "html", yml: "yaml", yaml: "yaml", sh: "shell", sql: "sql", kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", cs: "csharp", toml: "ini", ini: "ini",
  };
  if (/dockerfile$/i.test(path)) return "dockerfile";
  return map[ext] ?? "plaintext";
}
