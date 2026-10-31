import vm from "node:vm";
import ts from "typescript";
import type { BisectResult, Commit, CommitTestResult, VerificationResult } from "@code-zero/shared";

/**
 * Deterministic verification harness for the CONTROLLED demo repository only.
 * It transpiles the demo's own TypeScript sources and runs a fixed behavioral suite in an
 * isolated `vm` context with no access to `require`, the filesystem, or the network.
 * It is never used for imported (untrusted) repositories.
 */

const NOW_ISO = "2026-10-28T12:00:00Z";

type Mods = Record<string, Record<string, (...args: unknown[]) => unknown>>;

interface HarnessTest {
  name: string;
  run: (m: Mods) => void;
}

class AssertionFailed extends Error {}
function expectEqual(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) throw new AssertionFailed(`${what}: expected ${String(expected)}, received ${String(actual)}`);
}
function expectThrows(fn: () => unknown, errorName: string, what: string) {
  try {
    fn();
  } catch (err) {
    if ((err as Error)?.name === errorName) return;
    throw new AssertionFailed(`${what}: expected ${errorName}, got ${(err as Error)?.name}`);
  }
  throw new AssertionFailed(`${what}: expected ${errorName} to be thrown, nothing was thrown`);
}

const SPRING25 = { code: "SPRING25", percent: 25, expiresAt: null };
const LOYALTY80 = { code: "LOYALTY80", percent: 80, expiresAt: null };

export const DEMO_SUITE: HarnessTest[] = [
  {
    name: "applies a single active coupon",
    run: (m) => expectEqual(m.discounts.applyDiscount(200, [SPRING25], new Date(NOW_ISO)), 150, "applyDiscount(200, [25%])"),
  },
  {
    name: "caps stacked coupons at MAX_TOTAL_PERCENT (60%)",
    run: (m) => expectEqual(m.discounts.applyDiscount(100, [SPRING25, LOYALTY80], new Date(NOW_ISO)), 40, "applyDiscount(100, [25%, 80%])"),
  },
  {
    name: "ignores expired coupons",
    run: (m) =>
      expectEqual(m.discounts.applyDiscount(100, [{ code: "SUMMER10", percent: 10, expiresAt: "2026-09-01T00:00:00Z" }], new Date(NOW_ISO)), 100, "applyDiscount with expired coupon"),
  },
  {
    name: "rejects invalid coupon percentages",
    run: (m) => expectThrows(() => m.discounts.applyDiscount(100, [{ code: "BAD150", percent: 150, expiresAt: null }], new Date(NOW_ISO)), "RangeError", "percent=150"),
  },
  {
    name: "order total is never negative",
    run: (m) => {
      const r = m.checkout.checkout([{ sku: "TEE", unitPrice: 52, quantity: 1 }], [SPRING25, LOYALTY80], "US-NY", new Date(NOW_ISO)) as { total: number };
      if (!(r.total >= 0)) throw new AssertionFailed(`checkout total: expected ≥ 0, received ${r.total}`);
    },
  },
  {
    name: "rejects out-of-range cart quantities",
    run: (m) => expectThrows(() => m.cart.validateCart([{ sku: "A", unitPrice: 10, quantity: 0 }]), "RangeError", "quantity=0"),
  },
];

const REQUIRED = ["src/discounts.ts", "src/checkout.ts", "src/cart.ts"];

function loadModules(files: Record<string, string>): Mods {
  const cache = new Map<string, Record<string, unknown>>();
  const context = vm.createContext({});
  const load = (path: string): Record<string, unknown> => {
    if (cache.has(path)) return cache.get(path)!;
    const src = files[path];
    if (src === undefined) throw new Error(`Module not found in snapshot: ${path}`);
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(path, module.exports);
    const fn = vm.runInContext(`(function (exports, require, module) {\n${js}\n})`, context, { timeout: 1000 }) as (
      e: unknown,
      r: (s: string) => unknown,
      m: unknown,
    ) => void;
    const dir = path.slice(0, path.lastIndexOf("/"));
    fn(module.exports, (spec: string) => {
      if (!spec.startsWith(".")) throw new Error(`External module "${spec}" is not available in the demo harness`);
      const parts = `${dir}/${spec}`.split("/");
      const out: string[] = [];
      for (const p of parts) {
        if (p === "..") out.pop();
        else if (p !== "." && p) out.push(p);
      }
      return load(`${out.join("/")}.ts`);
    }, module);
    cache.set(path, module.exports);
    return module.exports;
  };
  return {
    discounts: load("src/discounts.ts") as Mods[string],
    checkout: load("src/checkout.ts") as Mods[string],
    cart: load("src/cart.ts") as Mods[string],
  };
}

export function isHarnessApplicable(files: Record<string, string>): boolean {
  return REQUIRED.every((p) => p in files);
}

export function runDemoSuite(commitSha: string, files: Record<string, string>): VerificationResult {
  const ranAt = new Date().toISOString();
  if (!isHarnessApplicable(files)) {
    return { id: `verify:${commitSha}`, commitSha, method: "demo-harness", ranAt, results: [], summary: "Not applicable: checkout pipeline does not exist at this commit." };
  }
  let mods: Mods;
  try {
    mods = loadModules(files);
  } catch (err) {
    return { id: `verify:${commitSha}`, commitSha, method: "demo-harness", ranAt, results: [{ testName: "load modules", passed: false, message: (err as Error).message }], summary: "Modules failed to load." };
  }
  const results: CommitTestResult[] = DEMO_SUITE.map((t) => {
    try {
      t.run(mods);
      return { testName: t.name, passed: true, message: null };
    } catch (err) {
      return { testName: t.name, passed: false, message: (err as Error).message };
    }
  });
  const failed = results.filter((r) => !r.passed).length;
  return {
    id: `verify:${commitSha}`,
    commitSha,
    method: "demo-harness",
    ranAt,
    results,
    summary: failed ? `${failed} of ${results.length} behavioral checks failed.` : `All ${results.length} behavioral checks passed.`,
  };
}

/**
 * Binary search for the first failing commit between a passing and a failing commit.
 * `chronological` must be ordered oldest → newest.
 */
export function bisectDemo(chronological: Commit[], snapshots: Map<string, Record<string, string>>, goodSha?: string | null, badSha?: string | null): BisectResult {
  const verification = new Map<string, VerificationResult>();
  const verify = (sha: string) => {
    if (!verification.has(sha)) verification.set(sha, runDemoSuite(sha, snapshots.get(sha) ?? {}));
    return verification.get(sha)!;
  };
  const applicable = chronological.filter((c) => isHarnessApplicable(snapshots.get(c.sha) ?? {}));
  let lo = goodSha ? applicable.findIndex((c) => c.sha.startsWith(goodSha)) : 0;
  let hi = badSha ? applicable.findIndex((c) => c.sha.startsWith(badSha)) : applicable.length - 1;
  const steps: BisectResult["steps"] = [];
  const passes = (i: number) => {
    const v = verify(applicable[i].sha);
    const ok = v.results.length > 0 && v.results.every((r) => r.passed);
    steps.push({ sha: applicable[i].sha, passed: ok });
    return ok;
  };
  if (lo < 0) lo = 0;
  if (hi < 0) hi = applicable.length - 1;
  if (applicable.length === 0 || !passes(lo)) {
    return { firstBadSha: null, lastGoodSha: null, steps, verification: [...verification.values()] };
  }
  if (passes(hi)) {
    return { firstBadSha: null, lastGoodSha: applicable[hi].sha, steps, verification: [...verification.values()] };
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(mid)) lo = mid;
    else hi = mid;
  }
  return { firstBadSha: applicable[hi].sha, lastGoodSha: applicable[lo].sha, steps, verification: [...verification.values()] };
}
