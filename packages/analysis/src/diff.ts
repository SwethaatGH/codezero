export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  context: string;
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Parses unified-diff hunk text (as returned by GitHub's `patch` field). File headers are ignored. */
export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      current = {
        header: raw,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        context: m[5] ?? "",
        lines: [],
      };
      oldNo = current.oldStart;
      newNo = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current) continue; // skip ---/+++/diff headers
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const marker = raw[0];
    const content = raw.slice(1);
    if (marker === "+") {
      current.lines.push({ type: "add", content, oldLine: null, newLine: newNo++ });
    } else if (marker === "-") {
      current.lines.push({ type: "del", content, oldLine: oldNo++, newLine: null });
    } else if (marker === " " || raw === "") {
      // An empty line at the very end of the patch text is not a context line.
      if (raw === "" && oldNo >= current.oldStart + current.oldLines && newNo >= current.newStart + current.newLines) continue;
      current.lines.push({ type: "context", content, oldLine: oldNo++, newLine: newNo++ });
    }
  }
  return hunks;
}

/** New-file line numbers touched by a patch. Deletions map to the nearest following new-file line. */
export function changedNewLines(hunks: DiffHunk[]): number[] {
  const out = new Set<number>();
  for (const h of hunks) {
    let nextNew = h.newStart;
    for (const l of h.lines) {
      if (l.type === "add" && l.newLine !== null) out.add(l.newLine);
      if (l.newLine !== null) nextNew = l.newLine + 1;
      if (l.type === "del") out.add(Math.max(1, nextNew));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Old-file line numbers removed by a patch. */
export function removedOldLines(hunks: DiffHunk[]): number[] {
  return hunks.flatMap((h) => h.lines.filter((l) => l.type === "del" && l.oldLine !== null).map((l) => l.oldLine!));
}

export function countPatch(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.type === "add") additions++;
      else if (l.type === "del") deletions++;
    }
  return { additions, deletions };
}
