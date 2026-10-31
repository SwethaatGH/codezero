import { describe, expect, it } from "vitest";
import { createInvestigationSchema } from "@code-zero/shared";
import {
  DEMO_REGRESSION_INDEX,
  assessCommit,
  bisectDemo,
  buildDemoHistory,
  buildDependencyGraph,
  buildReport,
  changedNewLines,
  computeBlastRadius,
  createUnifiedPatch,
  diffPackageJson,
  fileFanIn,
  parseModule,
  parsePatch,
  parseRepoInput,
  rankSuspects,
  reportToMarkdown,
  resolveJsImport,
  validatePatch,
} from "../src";
import type { Investigation } from "@code-zero/shared";

describe("GitHub URL parsing", () => {
  it.each([
    ["facebook/react", "facebook", "react"],
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://github.com/vercel/next.js.git", "vercel", "next.js"],
    ["github.com/owner/repo/tree/main/src", "owner", "repo"],
    ["git@github.com:owner/repo.git", "owner", "repo"],
    ["  owner/repo/ ", "owner", "repo"],
  ])("parses %s", (input, owner, name) => {
    expect(parseRepoInput(input)).toEqual({ owner, name });
  });

  it.each(["", "react", "https://gitlab.com/a/b", "https://github.com/onlyowner", "a b/c", "owner/..", "http://evil.com/github.com/a/b"])("rejects %s", (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });
});

describe("Commit range validation", () => {
  const base = { repositoryId: "a/b", branch: "main" };
  it("requires both SHAs for regression hunt", () => {
    const r = createInvestigationSchema.safeParse({ ...base, mode: "regression-hunt", goodSha: "abc1234" });
    expect(r.success).toBe(false);
  });
  it("rejects identical good and bad commits", () => {
    const r = createInvestigationSchema.safeParse({ ...base, mode: "regression-hunt", goodSha: "abc1234", badSha: "ABC1234" });
    expect(r.success).toBe(false);
  });
  it("rejects inverted date ranges", () => {
    const r = createInvestigationSchema.safeParse({ ...base, mode: "quick-scan", since: "2026-10-10T00:00:00Z", until: "2026-10-01T00:00:00Z" });
    expect(r.success).toBe(false);
  });
  it("rejects non-hex SHAs", () => {
    const r = createInvestigationSchema.safeParse({ ...base, mode: "single-commit", commitSha: "not-a-sha" });
    expect(r.success).toBe(false);
  });
  it("accepts a valid quick scan with defaults", () => {
    const r = createInvestigationSchema.parse({ ...base, mode: "quick-scan" });
    expect(r.limit).toBe(20);
  });
});

describe("Diff parsing", () => {
  const patch = ["@@ -1,4 +1,5 @@", " a", "-b", "+B", "+C", " d", "\\ No newline at end of file", "@@ -10,2 +11,1 @@ function x()", " k", "-gone"].join("\n");
  it("tracks old and new line numbers", () => {
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines.map((l) => [l.type, l.oldLine, l.newLine])).toEqual([
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
    ]);
    expect(hunks[1].context).toBe("function x()");
  });
  it("maps changes to new-file lines", () => {
    expect(changedNewLines(parsePatch(patch))).toEqual([2, 3, 12]);
  });
  it("returns nothing for null patches", () => {
    expect(parsePatch(null)).toEqual([]);
  });
});

describe("AST parsing", () => {
  it("extracts functions, imports and calls", () => {
    const m = parseModule(
      "src/a.ts",
      `import { b, c as d } from "./b";\nimport * as ns from "./n";\nexport function a() { return b() + d() + ns.q(); }\nconst arrow = () => a();\nexport class K { run() { return arrow(); } }\n`,
    );
    expect(m.functions.map((f) => `${f.kind}:${f.name}:${f.exported}`)).toEqual(["function:a:true", "arrow:arrow:false", "class:K:true", "method:K.run:false"]);
    expect(m.imports[0].bindings).toEqual([{ local: "b", imported: "b" }, { local: "d", imported: "c" }]);
    expect(m.calls.map((c) => c.callee)).toEqual(["b", "d", "ns.q", "a", "arrow"]);
  });
  it("reports malformed source without throwing", () => {
    const m = parseModule("src/bad.ts", "export function (");
    expect(m.parseError).toMatch(/Syntax errors/);
  });
  it("resolves relative imports including .js → .ts", () => {
    const known = new Set(["src/a.ts", "src/lib/index.ts"]);
    expect(resolveJsImport("src/b.ts", "./a.js", known)).toBe("src/a.ts");
    expect(resolveJsImport("src/x/y.ts", "../lib", known)).toBe("src/lib/index.ts");
    expect(resolveJsImport("src/b.ts", "react", known)).toBeNull();
  });
});

describe("Demo pipeline", () => {
  const demo = buildDemoHistory();
  const head = demo.commits[0];
  const files = Object.entries(demo.snapshots.get(head.sha)!).map(([path, content]) => ({ path, content }));
  const { graph, parsed } = buildDependencyGraph(files, { headSha: head.sha });
  const fanIn = fileFanIn(graph);
  const chronological = [...demo.commits].reverse();
  const regression = chronological[DEMO_REGRESSION_INDEX];

  const assessments = demo.commits.map((c) => {
    const functionsByFile = new Map<string, ReturnType<typeof parseModule>["functions"]>();
    for (const f of c.files) {
      const content = demo.snapshots.get(c.sha)![f.path];
      if (content) functionsByFile.set(f.path, parseModule(f.path, content).functions);
    }
    return assessCommit(c, { functionsByFile, fanIn });
  });

  it("is deterministic", () => {
    expect(buildDemoHistory().commits[0].sha).toBe(head.sha);
    expect(demo.commits).toHaveLength(11);
  });

  it("builds a real dependency graph with call edges", () => {
    expect(graph.level).toBe("function");
    const ids = graph.edges.map((e) => e.id);
    expect(ids).toContain("import:file:src/checkout.ts->file:src/discounts.ts");
    expect(ids).toContain("call:fn:src/checkout.ts#checkout->fn:src/discounts.ts#applyDiscount");
    expect(ids).toContain("call:fn:src/api/routes.ts#handleCheckout->fn:src/checkout.ts#checkout");
    expect(parsed.size).toBeGreaterThan(5);
    // every edge endpoint exists
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
  });

  it("scores the injected regression highest with removed-validation evidence", () => {
    const a = assessments.find((x) => x.commitSha === regression.sha)!;
    const kinds = a.signals.map((s) => s.kind);
    expect(kinds).toContain("removed-validation");
    expect(kinds).toContain("missing-tests");
    expect(a.modifiedFunctions.map((f) => f.name)).toContain("applyDiscount");
    const ranked = rankSuspects(demo.commits, assessments);
    expect(ranked[0].commitSha).toBe(regression.sha);
    expect(ranked.length).toBeLessThanOrEqual(5);
  });

  it("keeps docs-only commits at zero", () => {
    const docs = demo.commits.find((c) => c.message.startsWith("Document"))!;
    expect(assessments.find((a) => a.commitSha === docs.sha)!.score).toBe(0);
  });

  it("produces unique, traceable evidence references", () => {
    const all = assessments.flatMap((a) => a.signals.flatMap((s) => s.evidence));
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all) {
      expect(e.commitSha).toBeTruthy();
      if (e.filePath) expect(demo.commits.find((c) => c.sha === e.commitSha)!.files.some((f) => f.path === e.filePath)).toBe(true);
    }
  });

  it("computes blast radius through call edges", () => {
    const a = assessments.find((x) => x.commitSha === regression.sha)!;
    const br = computeBlastRadius(graph, { commitSha: regression.sha, changedFiles: ["src/discounts.ts"], modifiedFunctionIds: a.modifiedFunctions.map((f) => f.id) });
    const affected = br.affected.map((x) => x.id);
    expect(affected).toContain("fn:src/checkout.ts#checkout");
    expect(affected).toContain("fn:src/api/routes.ts#handleCheckout");
    expect(br.relatedTests).toContain("test/discounts.test.ts");
    expect(br.affected.find((x) => x.id === "fn:src/checkout.ts#checkout")!.via).toBe("call");
  });

  it("bisects to the regression with the deterministic harness", () => {
    const result = bisectDemo(chronological, demo.snapshots);
    expect(result.firstBadSha).toBe(regression.sha);
    expect(result.lastGoodSha).toBe(chronological[DEMO_REGRESSION_INDEX - 1].sha);
    const bad = result.verification.find((v) => v.commitSha === regression.sha)!;
    expect(bad.results.filter((r) => !r.passed).map((r) => r.testName)).toEqual([
      "caps stacked coupons at MAX_TOTAL_PERCENT (60%)",
      "ignores expired coupons",
      "rejects invalid coupon percentages",
      "order total is never negative",
    ]);
    const ranked = rankSuspects(demo.commits, assessments, { bisect: result });
    expect(ranked[0].status).toBe("test-confirmed");
  });

  it("generates reports only from stored data", () => {
    const inv: Investigation = {
      id: "inv_1", name: "Demo", repositoryId: demo.repository.id, repoFullName: demo.repository.fullName, branch: "main", mode: "quick-scan",
      status: "running", isDemo: true,
      params: { limit: 20, since: null, until: null, goodSha: null, badSha: null, commitSha: null, symptoms: null },
      createdAt: "", updatedAt: "", commitRange: { from: null, to: null, count: 0 }, selectedCommitSha: null, knownGoodSha: null, knownBadSha: null,
      findings: rankSuspects(demo.commits, assessments), notes: [], bookmarks: [], progress: { stages: [], percent: 0, logs: [] }, error: null, reportIds: [],
    };
    const incomplete = buildReport({ id: "r1", createdAt: "now", investigation: inv, repository: demo.repository, analysis: null, aiAnalyses: [], patches: [] });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.suspiciousCommits).toEqual([]);
    const done = buildReport({
      id: "r2", createdAt: "now", investigation: { ...inv, status: "completed" }, repository: demo.repository,
      analysis: { investigationId: "inv_1", commits: demo.commits, assessments, graph, health: null, bisect: null, generatedAt: "now" }, aiAnalyses: [], patches: [],
    });
    expect(done.suspiciousCommits[0].sha).toBe(regression.sha);
    const md = reportToMarkdown(done);
    expect(md).toContain("SIMULATED DEMO DATA");
    expect(md).toContain(regression.shortSha);
  });
});

describe("Patches and manifests", () => {
  it("creates and validates unified patches", () => {
    const p = createUnifiedPatch("src/a.ts", "a\nb\nc\n", "a\nB\nc\n");
    expect(validatePatch(p)).toMatchObject({ valid: true, hunks: 1 });
    expect(validatePatch("").valid).toBe(false);
    expect(validatePatch(p.replace("@@ -1,3 +1,3 @@", "@@ -1,9 +1,3 @@")).valid).toBe(false);
  });
  it("diffs package.json dependencies", () => {
    const d = diffPackageJson('{"dependencies":{"a":"1","b":"1"}}', '{"dependencies":{"a":"2","c":"1"}}');
    expect(d).toEqual({ added: ["c@1"], removed: ["b@1"], changed: ["a: 1 → 2"] });
    expect(diffPackageJson("{bad", "{}")).toBeNull();
  });
});
