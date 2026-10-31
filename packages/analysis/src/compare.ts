import type { CompareResult } from "@code-zero/shared";
import { parseModule } from "./ast";
import { isJsTs } from "./classify";

/** Diffs dependency sections of two package.json texts. Returns null when either side is not valid JSON. */
export function diffPackageJson(before: string | null, after: string | null): { added: string[]; removed: string[]; changed: string[] } | null {
  const parse = (s: string | null): Record<string, string> | null => {
    if (s === null) return {};
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = j[section];
        if (deps && typeof deps === "object") for (const [k, v] of Object.entries(deps)) out[`${k}${section === "dependencies" ? "" : ` (${section})`}`] = String(v);
      }
      return out;
    } catch {
      return null;
    }
  };
  const a = parse(before);
  const b = parse(after);
  if (!a || !b) return null;
  const added = Object.keys(b).filter((k) => !(k in a)).map((k) => `${k}@${b[k]}`);
  const removed = Object.keys(a).filter((k) => !(k in b)).map((k) => `${k}@${a[k]}`);
  const changed = Object.keys(b).filter((k) => k in a && a[k] !== b[k]).map((k) => `${k}: ${a[k]} → ${b[k]}`);
  return { added, removed, changed };
}

/** Function-level diff between two versions of a JS/TS file using the AST. */
export function diffFunctions(path: string, before: string | null, after: string | null): CompareResult["functionChanges"] {
  if (!isJsTs(path)) return [];
  const bodyOf = (src: string, start: number, end: number) => src.split("\n").slice(start - 1, end).join("\n").replace(/\s+/g, " ");
  const a = before ? parseModule(path, before).functions : [];
  const b = after ? parseModule(path, after).functions : [];
  const out: CompareResult["functionChanges"] = [];
  const aMap = new Map(a.map((f) => [f.name, f]));
  const bMap = new Map(b.map((f) => [f.name, f]));
  for (const [name, fb] of bMap) {
    const fa = aMap.get(name);
    if (!fa) out.push({ filePath: path, name, change: "added" });
    else if (fb.kind !== "class" && bodyOf(before!, fa.startLine, fa.endLine) !== bodyOf(after!, fb.startLine, fb.endLine))
      out.push({ filePath: path, name, change: "modified" });
  }
  for (const name of aMap.keys()) if (!bMap.has(name)) out.push({ filePath: path, name, change: "removed" });
  return out;
}
