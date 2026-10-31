# Demo repository: `code-zero-demo/orbit-checkout` (SIMULATED)

The demo is a small TypeScript checkout pricing service: carts, coupons, regional tax and an HTTP route. Its history is defined in [`packages/analysis/src/demo/fixture.ts`](../packages/analysis/src/demo/fixture.ts) as full file snapshots per commit. Diffs, stats and SHAs are generated deterministically from those snapshots, so everything the UI shows is internally consistent.

It is **clearly labeled as simulated** everywhere in the UI and in exported reports.

## History

| # | Commit | Role |
|---|---|---|
| 1 | Initial checkout service scaffold | baseline |
| 2 | Add discount engine with coupon support | adds expiry check, % validation, 60% cap |
| 3 | Add regional tax calculation | |
| 4 | Wire checkout pipeline and HTTP route | |
| 5 | Add cart validation tests | last known good |
| **6** | **Refactor discount stacking for seasonal promos** | **Patient Zero.** Drops the expiry filter, the `RangeError` validation and `Math.min(…, MAX_TOTAL_PERCENT)` |
| 7 | Bump zod to 3.24 and add lint script | decoy (manifest) |
| 8 | Use half-up rounding for EU tax regions | decoy (control flow + config) |
| 9 | Document checkout API | docs only (score 0) |
| 10 | Add request logging to checkout route | decoy (error handling) |
| 11 | Simplify cart validation loop | **heuristic false positive.** Guards are rewritten, not removed; tests pass |

## Symptoms used by the demo investigation

> Customers report negative order totals when combining the SPRING25 coupon with the loyalty discount. Expired coupons are also being accepted at checkout. Error: order total -2.70 rejected by payment gateway.

## Deterministic verification

[`packages/analysis/src/demo/harness.ts`](../packages/analysis/src/demo/harness.ts) transpiles the demo's own sources and runs six behavioral checks in an isolated `vm` context, with no `require`, filesystem or network access. A binary search over the history finds the first failing commit, which is commit 6.

Restore Lab's **Verify treatment** applies a proposed patch to the latest snapshot and re-runs the same checks. The harness is **never** used on imported repositories.

## Prerecorded AI

When Gemma is unavailable, structured analyses for commits 6 and 11 fall back to prerecorded content. That content:

- comes from [`apps/api/src/ai/prerecorded.ts`](../apps/api/src/ai/prerecorded.ts);
- is labeled `PRERECORDED DEMO`;
- cites real evidence IDs.

Live chat is never faked.
