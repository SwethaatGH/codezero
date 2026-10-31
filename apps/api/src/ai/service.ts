import { randomUUID } from "node:crypto";
import { applyPatch, parsePatch } from "diff";
import type { AIAnalysis, AITask, AnalysisResult, ExplanationLevel, Investigation, PatchSuggestion, Repository, VerificationResult } from "@code-zero/shared";
import { aiOutputSchema, aiPatchOutputSchema } from "@code-zero/shared";
import { buildDemoHistory, createUnifiedPatch, runDemoSuite, validatePatch } from "@code-zero/analysis";
import type { DB } from "../db";
import { ApiError, notFound } from "../errors";
import { sourceFor } from "../sources";
import { buildContext, systemPrompt } from "./context";
import { PRERECORDED_FIX, PRERECORDED_TEST_FILE, prerecordedAnalysis } from "./prerecorded";
import { checkAIStatus, generateStructured } from "./provider";

export function loadInvestigationBundle(db: DB, id: string): { inv: Investigation; analysis: AnalysisResult; repo: Repository } {
  const inv = db.getInvestigation(id);
  if (!inv) throw notFound("Investigation");
  const analysis = db.getAnalysis(id);
  if (!analysis) throw new ApiError(409, "ANALYSIS_INCOMPLETE", "This investigation has not finished analysis yet.");
  const repo = db.getRepository(inv.repositoryId);
  if (!repo) throw notFound("Repository");
  return { inv, analysis, repo };
}

function resolveCommit(analysis: AnalysisResult, sha: string | null) {
  if (!sha) return null;
  const c = analysis.commits.find((x) => x.sha === sha || x.sha.startsWith(sha));
  if (!c) throw new ApiError(404, "COMMIT_NOT_IN_INVESTIGATION", `Commit ${sha} is not part of this investigation.`);
  return c;
}

export async function runAnalysis(
  db: DB,
  input: { investigationId: string; task: AITask; commitSha: string | null; compareBase: string | null; level: ExplanationLevel },
  signal?: AbortSignal,
): Promise<AIAnalysis> {
  const { inv, analysis, repo } = loadInvestigationBundle(db, input.investigationId);
  const commit = resolveCommit(analysis, input.commitSha ?? inv.selectedCommitSha);
  let compare = null;
  if (input.compareBase && commit) {
    const files = await sourceFor(db, inv.repositoryId).compareFiles(input.compareBase, commit.sha);
    compare = { base: input.compareBase, head: commit.sha, files };
  }
  const ctx = buildContext({ repo, inv, analysis, commitSha: commit?.sha ?? null, compare });
  const settings = db.getSettings();
  const status = await checkAIStatus(settings, false);

  let out;
  let source: AIAnalysis["source"] = "live";
  let model: string | null = null;
  if (status.state === "connected") {
    const r = await generateStructured(settings, aiOutputSchema, [
      { role: "system", content: systemPrompt(input.task, input.level) },
      { role: "user", content: ctx.text },
    ], signal);
    out = r.data;
    model = r.model;
  } else if (repo.isDemo && commit) {
    const a = analysis.assessments.find((x) => x.commitSha === commit.sha);
    out = a ? prerecordedAnalysis(input.task, commit, a, analysis.bisect) : null;
    if (!out) throw new ApiError(503, "AI_UNAVAILABLE", `${status.message} Prerecorded demo analysis exists only for the discount refactor and cart refactor commits.`);
    source = "prerecorded-demo";
  } else {
    throw new ApiError(503, "AI_UNAVAILABLE", status.message);
  }

  const known = new Set(ctx.evidence.map((e) => e.id));
  const cited = [...out.observations.flatMap((o) => o.evidenceIds), ...out.hypotheses.flatMap((h) => h.evidenceIds)];
  const result: AIAnalysis = {
    id: `ai_${randomUUID()}`,
    task: input.task,
    commitSha: commit?.sha ?? null,
    level: input.level,
    source,
    model,
    createdAt: new Date().toISOString(),
    ...out,
    // Strip citations to IDs that were never provided, but keep a record of them.
    observations: out.observations.map((o) => ({ ...o, evidenceIds: o.evidenceIds.filter((id) => known.has(id)) })),
    hypotheses: out.hypotheses.map((h) => ({ ...h, evidenceIds: h.evidenceIds.filter((id) => known.has(id)) })),
    unknownEvidenceIds: [...new Set(cited.filter((id) => !known.has(id)))],
    evidence: ctx.evidence.filter((e) => cited.includes(e.id)),
  };
  db.saveAI(result, inv.id);
  return result;
}

/** Proposes a treatment. "revert" is deterministic; "minimal" and "preventive" use Gemma (or labeled demo fallback). */
export async function generateFix(db: DB, input: { investigationId: string; commitSha: string; strategy: PatchSuggestion["strategy"] }, signal?: AbortSignal): Promise<PatchSuggestion> {
  const { inv, analysis, repo } = loadInvestigationBundle(db, input.investigationId);
  const commit = resolveCommit(analysis, input.commitSha)!;
  const source = sourceFor(db, inv.repositoryId);
  const assessment = analysis.assessments.find((a) => a.commitSha === commit.sha);
  let patch: PatchSuggestion;

  if (input.strategy === "revert") {
    const parent = commit.parents[0];
    if (!parent) throw new ApiError(422, "NO_PARENT", "This is a root commit; it cannot be reverted as a patch.");
    const parts: string[] = [];
    const targets: string[] = [];
    for (const f of commit.files.filter((x) => !x.binary).slice(0, 20)) {
      const after = await source.getFile(f.path, commit.sha);
      const before = f.status === "added" ? "" : await source.getFile(f.previousPath ?? f.path, parent);
      if (after === null && before === null) continue;
      parts.push(createUnifiedPatch(f.path, after ?? "", before ?? ""));
      targets.push(f.path);
    }
    const text = parts.join("\n");
    patch = {
      id: `patch_${randomUUID()}`,
      strategy: "revert",
      title: `Revert ${commit.shortSha}`,
      description: `Reverses every change made in "${commit.message.split("\n")[0]}". Equivalent to \`git revert ${commit.shortSha}\` when no later commit touched the same lines.`,
      targetFiles: targets,
      rationale: "Restores the exact pre-commit behavior. Safest when the commit is confirmed as the regression origin, but it also discards any intended improvements it contained.",
      expectedBehavior: "Behavior identical to the parent commit for the reverted files.",
      risks: ["Later commits that depend on this change may conflict or break.", "Drops intended functionality from the commit."],
      verification: ["Run the full test suite after reverting.", "Check later commits in the range for edits to the same files."],
      patch: text,
      original: targets.length === 1 ? await source.getFile(targets[0], commit.sha) : null,
      proposed: targets.length === 1 ? await source.getFile(targets[0], parent) : null,
      verified: false,
      patchValid: false,
      patchError: null,
    };
  } else {
    const targetFile =
      input.strategy === "preventive"
        ? null
        : (assessment?.signals.flatMap((s) => s.evidence).find((e) => e.filePath && e.kind === "diff-line")?.filePath ?? commit.files.find((f) => !f.binary && f.status !== "removed")?.path);
    if (input.strategy === "minimal" && !targetFile) throw new ApiError(422, "NO_TARGET", "No source file in this commit to patch.");
    const original = targetFile ? ((await source.getFile(targetFile, commit.sha)) ?? "") : "";
    const settings = db.getSettings();
    const status = await checkAIStatus(settings, false);
    let p: { title: string; description: string; targetFile: string; rationale: string; expectedBehavior: string; risks: string[]; verification: string[]; proposedContent: string };
    let label = "";
    if (status.state === "connected") {
      const ctx = buildContext({ repo, inv, analysis, commitSha: commit.sha });
      const instructions =
        input.strategy === "minimal"
          ? `Propose the SMALLEST change to ${targetFile} that fixes the suspected regression while keeping the commit's intended improvements. Return the COMPLETE new file content in proposedContent. Current content of ${targetFile} at ${commit.shortSha}:\n\`\`\`\n${original.slice(0, 12000)}\n\`\`\``
          : "Write a NEW regression test file that would detect the suspected regression. Choose a sensible path under the repository's existing test directory for targetFile and return the COMPLETE file in proposedContent.";
      const r = await generateStructured(settings, aiPatchOutputSchema, [
        { role: "system", content: "You are Gemma inside CODE ZERO. Produce a treatment proposal as JSON with keys: title, description, targetFile, rationale, expectedBehavior, risks[], verification[], proposedContent. Never invent APIs that are not visible in the context." },
        { role: "user", content: `${ctx.text}\n\nTASK: ${instructions}` },
      ], signal);
      p = r.data;
      if (input.strategy === "minimal") p.targetFile = targetFile!;
    } else if (repo.isDemo && /Refactor discount stacking/.test(commit.message)) {
      p = input.strategy === "minimal"
        ? { ...PRERECORDED_FIX, targetFile: PRERECORDED_FIX.targetFile, proposedContent: PRERECORDED_FIX.content }
        : { title: "Add discount regression tests", description: "New test file pinning stacking cap, expiry and validation behavior.", targetFile: PRERECORDED_TEST_FILE.path, rationale: "No tests changed with the refactor; these would have caught it.", expectedBehavior: "Fails on the regressed commit, passes once guards are restored.", risks: [], verification: ["Run `npm test`."], proposedContent: PRERECORDED_TEST_FILE.content };
      label = " (prerecorded demo)";
    } else {
      throw new ApiError(503, "AI_UNAVAILABLE", `${status.message}${repo.isDemo ? " Prerecorded treatments exist only for the discount refactor commit." : ""} The deterministic "revert" strategy works without Gemma.`);
    }
    const before = input.strategy === "minimal" ? original : ((await source.getFile(p.targetFile, commit.sha)) ?? "");
    patch = {
      id: `patch_${randomUUID()}`,
      strategy: input.strategy,
      title: p.title + label,
      description: p.description,
      targetFiles: [p.targetFile],
      rationale: p.rationale,
      expectedBehavior: p.expectedBehavior,
      risks: p.risks,
      verification: p.verification,
      patch: createUnifiedPatch(p.targetFile, before, p.proposedContent.endsWith("\n") ? p.proposedContent : `${p.proposedContent}\n`),
      original: before,
      proposed: p.proposedContent,
      verified: false,
      patchValid: false,
      patchError: null,
    };
  }

  const v = validatePatch(patch.patch);
  patch.patchValid = v.valid;
  patch.patchError = v.error;
  db.savePatch(patch, inv.id);
  return patch;
}

/**
 * Demo-only verification: applies the patch to the latest analyzed snapshot and runs the deterministic harness.
 * Imported repositories are never executed.
 */
export function verifyPatch(db: DB, investigationId: string, patchId: string): { patch: PatchSuggestion; result: VerificationResult } {
  const { inv, analysis, repo } = loadInvestigationBundle(db, investigationId);
  const patch = db.getPatch(patchId);
  if (!patch) throw notFound("Patch");
  if (!repo.isDemo) throw new ApiError(422, "VERIFICATION_UNSUPPORTED", "Automated verification is only available for the controlled demo repository. CODE ZERO never executes imported repository code.");
  if (!patch.patchValid) throw new ApiError(422, "INVALID_PATCH", `Patch is not well-formed: ${patch.patchError}`);
  const head = analysis.commits[0];
  const snapshot = { ...(buildDemoHistory().snapshots.get(head.sha) ?? {}) };
  for (const filePatch of parsePatch(patch.patch)) {
    const path = (filePatch.newFileName ?? filePatch.oldFileName ?? "").replace(/^[ab]\//, "");
    if (!path || filePatch.hunks.length === 0) continue;
    const applied = applyPatch(snapshot[path] ?? "", filePatch);
    if (applied === false) {
      throw new ApiError(409, "PATCH_DOES_NOT_APPLY", `Patch does not apply cleanly to ${path} at ${head.shortSha} (latest analyzed commit).`);
    }
    snapshot[path] = applied;
  }
  const result = runDemoSuite(head.sha, snapshot);
  const passed = result.results.length > 0 && result.results.every((r) => r.passed);
  const updated: PatchSuggestion = { ...patch, verified: passed };
  db.savePatch(updated, inv.id);
  return { patch: updated, result: { ...result, id: `verify:${patch.id}`, summary: `Patched ${head.shortSha}: ${result.summary}` } };
}
