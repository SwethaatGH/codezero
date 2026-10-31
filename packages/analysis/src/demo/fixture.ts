/**
 * SIMULATED DEMO REPOSITORY — "orbit-checkout".
 *
 * A small TypeScript checkout service whose history contains one deliberately introduced
 * regression (commit 6, "Refactor discount stacking for seasonal promos") plus several
 * realistic decoy commits. Commit diffs are generated from these snapshots, so every
 * patch, line number and stat shown in the demo is internally consistent.
 */

export interface DemoCommitSpec {
  message: string;
  author: { name: string; email: string; login: string };
  date: string;
  /** path → full new content, or null to delete */
  changes: Record<string, string | null>;
}

const MARA = { name: "Mara Okafor", email: "mara@orbit.example", login: "mara-okafor" };
const DEV = { name: "Dev Patel", email: "dev@orbit.example", login: "devpatel" };
const LENA = { name: "Lena Fischer", email: "lena@orbit.example", login: "lfischer" };
const TOMAS = { name: "Tomás Reyes", email: "tomas@orbit.example", login: "treyes" };

const pkg = (zod: string, extraScripts = "") => `{
  "name": "orbit-checkout",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"${extraScripts}
  },
  "dependencies": {
    "zod": "${zod}"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
`;

const MONEY = `export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}
`;

const CART_V1 = `import { roundCents } from "./money";

export interface CartItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

export const MAX_QUANTITY = 99;

export function validateCart(items: CartItem[]): void {
  if (items.length === 0) throw new Error("Cart is empty");
  for (const item of items) {
    if (item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw new RangeError(\`Invalid quantity for \${item.sku}\`);
    }
    if (item.unitPrice < 0) throw new RangeError(\`Invalid price for \${item.sku}\`);
  }
}

export function cartSubtotal(items: CartItem[]): number {
  return roundCents(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
}
`;

const CART_V2 = `import { roundCents } from "./money";

export interface CartItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

export const MAX_QUANTITY = 99;

export function validateCart(items: CartItem[]): void {
  if (items.length === 0) throw new Error("Cart is empty");
  const badQuantity = items.find((item) => item.quantity < 1 || item.quantity > MAX_QUANTITY);
  if (badQuantity) throw new RangeError(\`Invalid quantity for \${badQuantity.sku}\`);
  const badPrice = items.find((item) => item.unitPrice < 0);
  if (badPrice) throw new RangeError(\`Invalid price for \${badPrice.sku}\`);
}

export function cartSubtotal(items: CartItem[]): number {
  return roundCents(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
}
`;

const DISCOUNTS_V1 = `import { roundCents } from "./money";

export interface Coupon {
  code: string;
  percent: number;
  expiresAt: string | null;
}

export const MAX_TOTAL_PERCENT = 60;

export function isCouponActive(coupon: Coupon, now: Date): boolean {
  if (!coupon.expiresAt) return true;
  return new Date(coupon.expiresAt).getTime() > now.getTime();
}

export function applyDiscount(subtotal: number, coupons: Coupon[], now: Date = new Date()): number {
  if (subtotal <= 0) return 0;
  let percent = 0;
  for (const coupon of coupons) {
    if (!isCouponActive(coupon, now)) continue;
    if (coupon.percent <= 0 || coupon.percent > 100) {
      throw new RangeError(\`Invalid coupon percent for \${coupon.code}\`);
    }
    percent += coupon.percent;
  }
  const capped = Math.min(percent, MAX_TOTAL_PERCENT);
  return roundCents(subtotal * (1 - capped / 100));
}
`;

// ⚠ The regression: guard, validation and cap removed while "refactoring" stacking.
const DISCOUNTS_V2 = `import { roundCents } from "./money";

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
  const seasonal = coupons.filter((coupon) => coupon.stackable !== false);
  const percent = stackPercents(seasonal);
  return roundCents(subtotal * (1 - percent / 100));
}
`;

const DISCOUNT_TEST = `import { describe, expect, it } from "vitest";
import { applyDiscount } from "../src/discounts";

describe("applyDiscount", () => {
  it("applies a single coupon", () => {
    expect(applyDiscount(100, [{ code: "SPRING25", percent: 25, expiresAt: null }])).toBe(75);
  });

  it("returns zero for empty subtotals", () => {
    expect(applyDiscount(0, [])).toBe(0);
  });
});
`;

const CART_TEST = `import { describe, expect, it } from "vitest";
import { cartSubtotal, validateCart } from "../src/cart";

describe("cart", () => {
  it("sums line items", () => {
    expect(cartSubtotal([{ sku: "A", unitPrice: 10, quantity: 3 }])).toBe(30);
  });

  it("rejects empty carts", () => {
    expect(() => validateCart([])).toThrow("Cart is empty");
  });

  it("rejects out-of-range quantities", () => {
    expect(() => validateCart([{ sku: "A", unitPrice: 10, quantity: 0 }])).toThrow(RangeError);
  });
});
`;

const CONFIG_V1 = `export const TAX_RATES: Record<string, number> = {
  "US-CA": 0.0725,
  "US-NY": 0.04,
  "EU-DE": 0.19,
  "EU-FR": 0.2,
};
`;

const CONFIG_V2 = `export const TAX_RATES: Record<string, number> = {
  "US-CA": 0.0725,
  "US-NY": 0.04,
  "EU-DE": 0.19,
  "EU-FR": 0.2,
  "EU-NL": 0.21,
};

export const EU_ROUNDING = "half-up";
`;

const TAX_V1 = `import { roundCents } from "./money";
import { TAX_RATES } from "./config";

export function calculateTax(amount: number, region: string): number {
  const rate = TAX_RATES[region];
  if (rate === undefined) throw new Error(\`Unknown tax region: \${region}\`);
  return roundCents(amount * rate);
}
`;

const TAX_V2 = `import { roundCents } from "./money";
import { EU_ROUNDING, TAX_RATES } from "./config";

export function calculateTax(amount: number, region: string): number {
  const rate = TAX_RATES[region];
  if (rate === undefined) throw new Error(\`Unknown tax region: \${region}\`);
  const raw = amount * rate;
  if (region.startsWith("EU-") && EU_ROUNDING === "half-up") {
    return Math.floor(raw * 100 + 0.5) / 100;
  }
  return roundCents(raw);
}
`;

const CHECKOUT = `import { cartSubtotal, validateCart, type CartItem } from "./cart";
import { applyDiscount, type Coupon } from "./discounts";
import { roundCents } from "./money";
import { calculateTax } from "./tax";

export interface CheckoutResult {
  subtotal: number;
  discounted: number;
  tax: number;
  total: number;
}

export function checkout(items: CartItem[], coupons: Coupon[], region: string, now: Date = new Date()): CheckoutResult {
  validateCart(items);
  const subtotal = cartSubtotal(items);
  const discounted = applyDiscount(subtotal, coupons, now);
  const tax = calculateTax(discounted, region);
  return { subtotal, discounted, tax, total: roundCents(discounted + tax) };
}
`;

const ROUTES_V1 = `import type { CartItem } from "../cart";
import { checkout } from "../checkout";
import type { Coupon } from "../discounts";

export interface CheckoutRequest {
  items: CartItem[];
  coupons: Coupon[];
  region: string;
}

export function handleCheckout(body: CheckoutRequest) {
  try {
    const result = checkout(body.items, body.coupons, body.region);
    return { status: 200, body: result };
  } catch (err) {
    return { status: 400, body: { error: (err as Error).message } };
  }
}
`;

const ROUTES_V2 = `import type { CartItem } from "../cart";
import { checkout } from "../checkout";
import type { Coupon } from "../discounts";
import { logRequest } from "../logger";

export interface CheckoutRequest {
  items: CartItem[];
  coupons: Coupon[];
  region: string;
}

export function handleCheckout(body: CheckoutRequest) {
  const started = Date.now();
  try {
    const result = checkout(body.items, body.coupons, body.region);
    logRequest("checkout", 200, Date.now() - started);
    return { status: 200, body: result };
  } catch (err) {
    logRequest("checkout", 400, Date.now() - started, err as Error);
    return { status: 400, body: { error: (err as Error).message } };
  }
}
`;

const LOGGER = `export interface LogEntry {
  route: string;
  status: number;
  durationMs: number;
  error: string | null;
}

export const entries: LogEntry[] = [];

export function logRequest(route: string, status: number, durationMs: number, error?: Error): void {
  entries.push({ route, status, durationMs, error: error ? error.message : null });
  if (entries.length > 500) entries.shift();
}
`;

const README_V1 = `# orbit-checkout

Checkout pricing service: carts, coupons, and regional tax.

\`\`\`
npm test
\`\`\`
`;

const README_V2 = `# orbit-checkout

Checkout pricing service: carts, coupons, and regional tax.

\`\`\`
npm test
\`\`\`

## API

\`handleCheckout({ items, coupons, region })\` returns \`{ status, body }\`.

Coupons stack up to \`MAX_TOTAL_PERCENT\` (60%). Expired coupons are ignored.
`;

export const DEMO_REPO = {
  owner: "code-zero-demo",
  name: "orbit-checkout",
  description: "SIMULATED demo repository: a TypeScript checkout pricing service with a deliberately introduced regression.",
  defaultBranch: "main",
  languages: { TypeScript: 6240, JSON: 380, Markdown: 420 },
};

export const DEMO_SYMPTOMS =
  "Customers report negative order totals when combining the SPRING25 coupon with the loyalty discount. Expired coupons are also being accepted at checkout. Error: order total -2.70 rejected by payment gateway.";

export const DEMO_COMMITS: DemoCommitSpec[] = [
  { message: "Initial checkout service scaffold", author: MARA, date: "2026-10-01T09:12:00Z", changes: { "package.json": pkg("^3.22.0"), "README.md": README_V1, "src/money.ts": MONEY, "src/cart.ts": CART_V1 } },
  { message: "Add discount engine with coupon support\n\nCoupons stack additively and are capped at MAX_TOTAL_PERCENT.", author: DEV, date: "2026-10-03T14:40:00Z", changes: { "src/discounts.ts": DISCOUNTS_V1, "test/discounts.test.ts": DISCOUNT_TEST } },
  { message: "Add regional tax calculation", author: LENA, date: "2026-10-06T10:05:00Z", changes: { "src/tax.ts": TAX_V1, "src/config.ts": CONFIG_V1 } },
  { message: "Wire checkout pipeline and HTTP route", author: MARA, date: "2026-10-08T16:22:00Z", changes: { "src/checkout.ts": CHECKOUT, "src/api/routes.ts": ROUTES_V1 } },
  { message: "Add cart validation tests", author: TOMAS, date: "2026-10-10T11:30:00Z", changes: { "test/cart.test.ts": CART_TEST } },
  { message: "Refactor discount stacking for seasonal promos\n\nIntroduce stackable flag and extract stackPercents helper.", author: DEV, date: "2026-10-14T18:51:00Z", changes: { "src/discounts.ts": DISCOUNTS_V2 } },
  { message: "Bump zod to 3.24 and add lint script", author: TOMAS, date: "2026-10-16T09:03:00Z", changes: { "package.json": pkg("^3.24.1", `,\n    "lint": "eslint src"`) } },
  { message: "Use half-up rounding for EU tax regions", author: LENA, date: "2026-10-19T13:17:00Z", changes: { "src/tax.ts": TAX_V2, "src/config.ts": CONFIG_V2 } },
  { message: "Document checkout API", author: MARA, date: "2026-10-21T08:45:00Z", changes: { "README.md": README_V2 } },
  { message: "Add request logging to checkout route", author: TOMAS, date: "2026-10-23T15:10:00Z", changes: { "src/api/routes.ts": ROUTES_V2, "src/logger.ts": LOGGER } },
  { message: "Simplify cart validation loop", author: MARA, date: "2026-10-27T10:28:00Z", changes: { "src/cart.ts": CART_V2 } },
];

/** Index (0-based) of the commit that introduced the regression. Used only by tests. */
export const DEMO_REGRESSION_INDEX = 5;
