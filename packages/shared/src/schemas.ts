import { z } from "zod";

export const shaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{4,40}$/i, "Expected a commit SHA (4–40 hex characters)");

export const investigationModeSchema = z.enum(["quick-scan", "regression-hunt", "single-commit", "exploration", "ai-guided"]);

export const importRepositorySchema = z.object({
  input: z.string().trim().min(1, "Repository is required"),
});

export const createInvestigationSchema = z
  .object({
    repositoryId: z.string().min(1),
    name: z.string().trim().max(120).optional(),
    branch: z.string().trim().min(1),
    mode: investigationModeSchema,
    limit: z.number().int().min(1).max(100).default(20),
    since: z.string().datetime({ offset: true }).nullable().default(null),
    until: z.string().datetime({ offset: true }).nullable().default(null),
    goodSha: shaSchema.nullable().default(null),
    badSha: shaSchema.nullable().default(null),
    commitSha: shaSchema.nullable().default(null),
    symptoms: z.string().trim().max(4000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "regression-hunt") {
      if (!v.goodSha) ctx.addIssue({ code: "custom", path: ["goodSha"], message: "Regression Hunt needs a known working commit" });
      if (!v.badSha) ctx.addIssue({ code: "custom", path: ["badSha"], message: "Regression Hunt needs a known broken commit" });
      if (v.goodSha && v.badSha && v.goodSha.toLowerCase() === v.badSha.toLowerCase())
        ctx.addIssue({ code: "custom", path: ["badSha"], message: "Working and broken commits must differ" });
    }
    if (v.mode === "single-commit" && !v.commitSha)
      ctx.addIssue({ code: "custom", path: ["commitSha"], message: "Select a commit to investigate" });
    if (v.mode === "ai-guided" && !v.symptoms)
      ctx.addIssue({ code: "custom", path: ["symptoms"], message: "Describe the bug or paste an error message" });
    if (v.since && v.until && new Date(v.since) > new Date(v.until))
      ctx.addIssue({ code: "custom", path: ["until"], message: "End date must be after start date" });
  });
export type CreateInvestigationInput = z.input<typeof createInvestigationSchema>;

export const updateInvestigationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  selectedCommitSha: z.string().nullable().optional(),
  knownGoodSha: z.string().nullable().optional(),
  knownBadSha: z.string().nullable().optional(),
  bookmarks: z
    .array(z.object({ sha: z.string(), label: z.string().nullable(), createdAt: z.string() }))
    .optional(),
  notes: z
    .array(z.object({ id: z.string(), text: z.string().max(4000), commitSha: z.string().nullable(), createdAt: z.string() }))
    .optional(),
});

export const compareSchema = z.object({
  investigationId: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
});

export const fileContentsSchema = z.object({
  investigationId: z.string().min(1),
  path: z.string().min(1),
  ref: z.string().min(1),
});

export const aiTaskSchema = z.enum(["root-cause", "semantic-diff", "impact", "tests", "fix", "alternatives", "commit-investigation"]);
export const explanationLevelSchema = z.enum(["beginner", "developer", "expert"]);

export const aiAnalyzeSchema = z.object({
  investigationId: z.string().min(1),
  task: aiTaskSchema,
  commitSha: z.string().nullable().default(null),
  compareBase: z.string().nullable().default(null),
  level: explanationLevelSchema.default("developer"),
});

export const aiChatSchema = z.object({
  investigationId: z.string().nullable().default(null),
  commitSha: z.string().nullable().default(null),
  level: explanationLevelSchema.default("developer"),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) }))
    .min(1)
    .max(40),
});

export const aiFixSchema = z.object({
  investigationId: z.string().min(1),
  commitSha: z.string().min(1),
  strategy: z.enum(["minimal", "revert", "preventive"]).default("minimal"),
});

export const createReportSchema = z.object({ investigationId: z.string().min(1) });

/** Shape the model must return. Validated server-side before anything reaches the UI. */
export const aiOutputSchema = z.object({
  summary: z.string().min(1),
  observations: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()).default([]) })).default([]),
  hypotheses: z
    .array(
      z.object({
        title: z.string(),
        explanation: z.string(),
        confidence: z.enum(["low", "medium", "high"]),
        evidenceIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  riskExplanation: z.string().default(""),
  suggestedTests: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        targetFile: z.string().nullable().default(null),
        code: z.string().default(""),
      }),
    )
    .default([]),
  recommendedActions: z.array(z.string()).default([]),
  uncertaintyNotes: z.array(z.string()).default([]),
});
export type AIOutput = z.infer<typeof aiOutputSchema>;

export const aiPatchOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  targetFile: z.string(),
  rationale: z.string(),
  expectedBehavior: z.string(),
  risks: z.array(z.string()).default([]),
  verification: z.array(z.string()).default([]),
  proposedContent: z.string().min(1),
});
export type AIPatchOutput = z.infer<typeof aiPatchOutputSchema>;
