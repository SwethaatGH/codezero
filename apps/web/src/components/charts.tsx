import type { ReactNode } from "react";
import type { TooltipProps } from "recharts";

/** Categorical palette, fixed order. Validated (dark, surface #101E29): lightness band, chroma, CVD ΔE ≥ 8, contrast ≥ 3:1. */
export const CATEGORICAL = ["#21A396", "#8C7CF0", "#C77A2E", "#4A8FE6", "#80954A", "#C770B0"];
/** Single-hue series color for magnitude charts. */
export const SERIES = "#40E0D0";
export const GRID = "#1d3343";
export const AXIS = { stroke: "#284558", tick: { fill: "#6f8693", fontSize: 11 }, tickLine: false, axisLine: false } as const;

export function ChartTooltip({ active, payload, label, format }: TooltipProps<number, string> & { format?: (label: string | number) => ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-2 bg-[#0c1a24] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-ink">{format ? format(label as string) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: (p.color as string) ?? SERIES }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-mono text-ink">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Accessible data table alternative for a chart. */
export function ChartTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs text-ink-2">
      <summary className="cursor-pointer select-none text-ink-3 hover:text-ink-2">View as table</summary>
      <div className="mt-2 max-h-48 overflow-auto rounded-md border border-line">
        <table className="w-full">
          <thead className="bg-white/[0.03] text-left text-ink-2">
            <tr>{columns.map((c) => <th key={c} className="px-2 py-1 font-medium">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => <td key={j} className="px-2 py-1 font-mono">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
