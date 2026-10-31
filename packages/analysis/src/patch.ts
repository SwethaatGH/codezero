import { createTwoFilesPatch, parsePatch as parseUnified } from "diff";

export function createUnifiedPatch(path: string, original: string, proposed: string, opts: { from?: string; to?: string } = {}): string {
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, original, proposed, opts.from ?? "", opts.to ?? "", { context: 3 });
}

/** Validates that text is a well-formed unified diff with at least one hunk whose counts match. */
export function validatePatch(patch: string): { valid: boolean; error: string | null; files: number; hunks: number } {
  if (!patch.trim()) return { valid: false, error: "Patch is empty", files: 0, hunks: 0 };
  try {
    const parsed = parseUnified(patch);
    const withHunks = parsed.filter((p) => p.hunks.length > 0);
    if (withHunks.length === 0) return { valid: false, error: "Patch contains no hunks (no changes)", files: 0, hunks: 0 };
    for (const p of withHunks)
      for (const h of p.hunks) {
        const oldCount = h.lines.filter((l) => l[0] === " " || l[0] === "-").length;
        const newCount = h.lines.filter((l) => l[0] === " " || l[0] === "+").length;
        if (oldCount !== h.oldLines || newCount !== h.newLines)
          return { valid: false, error: `Hunk @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ line counts do not match its body`, files: withHunks.length, hunks: 0 };
      }
    return { valid: true, error: null, files: withHunks.length, hunks: withHunks.reduce((s, p) => s + p.hunks.length, 0) };
  } catch (err) {
    return { valid: false, error: (err as Error).message, files: 0, hunks: 0 };
  }
}
