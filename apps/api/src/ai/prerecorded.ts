import type { AITask, BisectResult, Commit, RiskAssessment } from "@code-zero/shared";
import type { AIOutput } from "@code-zero/shared";

/**
 * PRERECORDED demo analysis. Used ONLY for the simulated demo repository when Gemma is unavailable,
 * and always labeled `source: "prerecorded-demo"` in the API and UI. Evidence IDs are looked up from
 * the real deterministic assessment so citations stay valid.
 */

function idsFor(a: RiskAssessment, match: RegExp): string[] {
  return a.signals.flatMap((s) => s.evidence).filter((e) => match.test(`${e.snippet ?? ""} ${e.description}`)).map((e) => e.id).slice(0, 4);
}

const testId = (b: BisectResult | null, c: Commit) => (b?.verification.some((v) => v.commitSha === c.sha) ? [`test:${c.shortSha}`] : []);

const REGRESSION_TEST = `import { describe, expect, it } from "vitest";
import { applyDiscount } from "../src/discounts";
import { checkout } from "../src/checkout";

const NOW = new Date("2026-10-28T12:00:00Z");
const SPRING25 = { code: "SPRING25", percent: 25, expiresAt: null };
const LOYALTY80 = { code: "LOYALTY80", percent: 80, expiresAt: null };

describe("discount regression guards", () => {
  it("caps stacked coupons at MAX_TOTAL_PERCENT", () => {
    expect(applyDiscount(100, [SPRING25, LOYALTY80], NOW)).toBe(40);
  });

  it("ignores expired coupons", () => {
    const expired = { code: "SUMMER10", percent: 10, expiresAt: "2026-09-01T00:00:00Z" };
    expect(applyDiscount(100, [expired], NOW)).toBe(100);
  });

  it("rejects out-of-range percentages", () => {
    expect(() => applyDiscount(100, [{ code: "BAD", percent: 150, expiresAt: null }], NOW)).toThrow(RangeError);
  });

  it("never produces a negative order total", () => {
    const r = checkout([{ sku: "TEE", unitPrice: 52, quantity: 1 }], [SPRING25, LOYALTY80], "US-NY", NOW);
    expect(r.total).toBeGreaterThanOrEqual(0);
  });
});
`;

export const PRERECORDED_FIX = {
  targetFile: "src/discounts.ts",
  title: "Restore expiry check, percent validation and stacking cap",
  description: "Keeps the new `stackable` flag and `stackPercents` helper, but re-applies the three guards that the refactor dropped.",
  rationale: "The pre-refactor version filtered expired coupons, rejected percentages outside (0, 100], and capped the stacked total at MAX_TOTAL_PERCENT. All three were removed in the same hunk.",
  expectedBehavior: "Stacked coupons never exceed 60%; expired coupons are ignored; invalid percentages throw RangeError. Totals can no longer go negative.",
  risks: ["Seasonal promotions that intentionally exceeded 60% would now be capped; confirm the business rule with product owners."],
  verification: ["Run the demo verification suite (Verify treatment).", "Add the generated regression tests to test/discounts.test.ts."],
  content: `import { roundCents } from "./money";

export interface Coupon {
  code: string;
  percent: number;
  expiresAt: string | null;
  stackable?: boolean;
}

export const MAX_TOTAL_PERCENT = 60;

export function isCouponActive(coupon: Coupon, now: Date): boolean {
  if (!coupon.expiresAt) return true;
  return new Date(coupon.expiresAt).getTime() > now.getTime();
}

export function stackPercents(coupons: Coupon[]): number {
  return coupons.reduce((sum, coupon) => sum + coupon.percent, 0);
}

export function applyDiscount(subtotal: number, coupons: Coupon[], now: Date = new Date()): number {
  if (subtotal <= 0) return 0;
  const seasonal = coupons.filter((coupon) => coupon.stackable !== false && isCouponActive(coupon, now));
  for (const coupon of seasonal) {
    if (coupon.percent <= 0 || coupon.percent > 100) {
      throw new RangeError(\`Invalid coupon percent for \${coupon.code}\`);
    }
  }
  const percent = Math.min(stackPercents(seasonal), MAX_TOTAL_PERCENT);
  return roundCents(subtotal * (1 - percent / 100));
}
`,
};

export const PRERECORDED_TEST_FILE = { path: "test/discount-regression.test.ts", content: REGRESSION_TEST };

export function prerecordedAnalysis(task: AITask, commit: Commit, a: RiskAssessment, bisect: BisectResult | null): AIOutput | null {
  const isRegression = /Refactor discount stacking/.test(commit.message);
  const isCartDecoy = /Simplify cart validation/.test(commit.message);
  if (!isRegression && !isCartDecoy) return null;

  if (isCartDecoy) {
    const guard = idsFor(a, /quantity|price/i);
    return {
      summary: "This commit rewrote cart validation from a for-loop into two Array.find calls. The guard conditions and error messages appear to be preserved, so the high heuristic score is likely a false positive.",
      observations: [
        { text: "The quantity bounds check `quantity < 1 || quantity > MAX_QUANTITY` is still present in the added code.", evidenceIds: guard },
        { text: "Both RangeError throws remain, now raised from the first offending item.", evidenceIds: guard },
        { text: "The demo verification suite passes at this commit.", evidenceIds: testId(bisect, commit) },
      ],
      hypotheses: [{ title: "Behavior-preserving refactor", explanation: "Validation order changed (all quantity checks before any price checks), which could change WHICH error is reported for carts with several invalid items, but not whether an error is raised.", confidence: "medium", evidenceIds: guard }],
      riskExplanation: "Scored high because removed lines matched guard patterns and the file is imported by checkout. Token overlap shows the logic was moved rather than dropped.",
      suggestedTests: [{ name: "reports the first invalid quantity", description: "A cart with two invalid items should throw for the first one.", targetFile: "test/cart.test.ts", code: `expect(() => validateCart([{ sku: "A", unitPrice: 1, quantity: 0 }, { sku: "B", unitPrice: -1, quantity: 1 }])).toThrow("Invalid quantity for A");` }],
      recommendedActions: ["Deprioritize this commit relative to the discount refactor.", "Add a test pinning error precedence for multi-error carts."],
      uncertaintyNotes: ["Prerecorded demo analysis; no live inference was performed."],
    };
  }

  const active = idsFor(a, /isCouponActive/);
  const range = idsFor(a, /percent <= 0|RangeError|throw/);
  const cap = idsFor(a, /Math\.min|capped/);
  const tests = testId(bisect, commit);
  const base: AIOutput = {
    summary:
      "Commit refactored discount stacking and, in the same hunk, removed three safeguards in applyDiscount: the coupon-expiry filter, the percent range validation, and the MAX_TOTAL_PERCENT cap. Stacking 25% + 80% now yields a 105% discount, producing negative totals, and expired coupons are applied.",
    observations: [
      { text: "`if (!isCouponActive(coupon, now)) continue;` was removed and not re-added; `now` is now unused in applyDiscount.", evidenceIds: active },
      { text: "The RangeError guard for percentages outside (0, 100] was removed.", evidenceIds: range },
      { text: "`Math.min(percent, MAX_TOTAL_PERCENT)` was removed; MAX_TOTAL_PERCENT is still exported but no longer used.", evidenceIds: cap },
      { text: "No test files changed in this commit.", evidenceIds: idsFor(a, /without accompanying test/) },
      ...(tests.length ? [{ text: "The deterministic verification suite fails 4 checks at this commit and passes at its parent.", evidenceIds: tests }] : []),
    ],
    hypotheses: [
      { title: "Uncapped stacking causes negative totals", explanation: "stackPercents sums all stackable coupons with no ceiling, so 25 + 80 = 105% and subtotal × (1 − 1.05) is negative. This matches the reported −2.70 total.", confidence: "high", evidenceIds: [...cap, ...tests] },
      { title: "Expired coupons accepted", explanation: "The filter now only checks `stackable !== false`; expiry is never evaluated.", confidence: "high", evidenceIds: active },
    ],
    riskExplanation: "Highest score in the range: removed validation (+24) in a business-critical pricing path imported by checkout, with exported function changes and no accompanying tests.",
    suggestedTests: [{ name: "discount regression guards", description: "Pins the cap, expiry and validation behavior.", targetFile: PRERECORDED_TEST_FILE.path, code: REGRESSION_TEST }],
    recommendedActions: ["Restore the three guards while keeping the stackable flag (see Restore Lab).", "Add regression tests for stacked and expired coupons.", "Consider a non-negative assertion on checkout totals."],
    uncertaintyNotes: ["Prerecorded demo analysis; no live inference was performed.", "Whether 60% is still the intended business cap should be confirmed."],
  };

  switch (task) {
    case "semantic-diff":
      return { ...base, summary: "Behavioral difference: before, applyDiscount ignored expired coupons, validated each percentage, and capped the total at 60%. After, it sums every coupon not explicitly marked `stackable: false`, with no expiry check, no validation, and no cap." };
    case "impact":
      return {
        ...base,
        summary: "applyDiscount is called by checkout(), which is called by handleCheckout() in the HTTP route. Any order with stacked coupons over 100% propagates a negative `discounted` value into calculateTax and the final total.",
        hypotheses: [
          { title: "Negative tax amounts", explanation: "calculateTax receives a negative amount and returns negative tax.", confidence: "medium", evidenceIds: cap },
          { title: "Payment gateway rejections", explanation: "Negative totals reach the route response; downstream payment would reject them (consistent with the reported symptom).", confidence: "medium", evidenceIds: [] },
        ],
      };
    case "alternatives":
      return {
        ...base,
        summary: "The discount refactor is the strongest candidate, but two other commits in range touch the pricing path and should be ruled out.",
        hypotheses: [
          { title: "Discount refactor (primary)", explanation: "Removed cap and expiry check directly explain both symptoms.", confidence: "high", evidenceIds: [...cap, ...active] },
          { title: "EU tax rounding change", explanation: "Changed rounding for EU regions; could shift totals by a cent but cannot make them negative or accept expired coupons.", confidence: "low", evidenceIds: [] },
          { title: "Cart validation rewrite", explanation: "Refactored guards, but logic appears preserved; would not affect discounts.", confidence: "low", evidenceIds: [] },
        ],
      };
    case "tests":
      return { ...base, summary: "Four focused tests detect the regression: cap enforcement, expired coupon handling, percent validation, and a non-negative checkout total." };
    case "commit-investigation":
      return { ...base, summary: "Flagged because removed lines matched validation/guard patterns (expiry filter, RangeError, Math.min cap) in a pricing file imported by checkout, with no test changes. Unlike the cart refactor, the removed logic does not reappear elsewhere in the diff." };
    default:
      return base;
  }
}
