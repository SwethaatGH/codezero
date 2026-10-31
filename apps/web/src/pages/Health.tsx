import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Flame, HeartPulse, Languages, Package, Settings2, TestTube2, Users } from "lucide-react";
import type { Investigation } from "@code-zero/shared";
import { useHealth } from "../lib/queries";
import { fmtDay, scoreColor, short } from "../lib/utils";
import { EmptyState, PageTitle, Panel, PanelHeader, ScoreBadge, SimulatedBanner, Skeleton, Stat } from "../components/ui";
import { InvestigationGate, useActiveInvestigation } from "../components/investigation";
import { AXIS, ChartTable, ChartTooltip, GRID, SERIES } from "../components/charts";

export default function Health() {
  return (
    <>
      <PageTitle themed="Repository Health" technical="Health monitor" description="Maintenance activity, change concentration and heuristic risk hotspots — computed from analyzed commits. This is not test-coverage data." />
      <InvestigationGate>{(inv) => <HealthView inv={inv} />}</InvestigationGate>
    </>
  );
}

function HealthView({ inv }: { inv: Investigation }) {
  const h = useHealth(inv);
  const { go } = useActiveInvestigation();
  const maxChurn = useMemo(() => Math.max(1, ...(h.data?.churnHeatmap ?? []).flatMap((r) => r.byCommit.map((c) => c.churn))), [h.data]);
  if (h.isLoading) return <Skeleton className="h-96" />;
  const d = h.data;
  if (!d) return <Panel><EmptyState title="Health data unavailable" /></Panel>;
  const totalChurn = d.contributors.reduce((s, c) => s + c.additions + c.deletions, 0);
  const commitsWithTests = new Set(d.testChanges.map((t) => t.sha)).size;
  const commits = d.riskTrend.length;

  return (
    <div className="space-y-4">
      {inv.isDemo && <SimulatedBanner />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Commits" value={commits} icon={<Activity className="h-3.5 w-3.5" />} />
        <Stat label="Contributors" value={d.contributors.length} icon={<Users className="h-3.5 w-3.5" />} />
        <Stat label="Code churn" value={totalChurn.toLocaleString()} sub="lines (excl. lockfiles)" />
        <Stat label="Test-touching commits" value={`${commitsWithTests}/${commits}`} icon={<TestTube2 className="h-3.5 w-3.5" />} sub={`${d.testFileCount} test files detected`} />
        <Stat label="Manifest changes" value={d.manifestChanges.length} icon={<Package className="h-3.5 w-3.5" />} />
        <Stat label="Config changes" value={d.configChanges.length} icon={<Settings2 className="h-3.5 w-3.5" />} />
      </div>

      <Panel>
        <PanelHeader title="Health summary" subtitle="Every statement is derived from the data on this page" icon={<HeartPulse className="h-4 w-4" />} />
        <ul className="grid gap-2 p-4 text-sm text-ink-2 md:grid-cols-2">
          {d.summary.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-bio" />{s}</li>)}
        </ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Commit activity" subtitle="Commits per day" icon={<Activity className="h-4 w-4" />} />
          <div className="p-4">
            <div className="h-52">
              <ResponsiveContainer>
                <BarChart data={d.commitActivity} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDay} />
                  <YAxis allowDecimals={false} {...AXIS} />
                  <Tooltip content={<ChartTooltip format={(l) => fmtDay(String(l))} />} cursor={{ fill: "rgba(64,224,208,0.05)" }} />
                  <Bar dataKey="commits" name="Commits" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartTable columns={["Date", "Commits", "+", "−"]} rows={d.commitActivity.map((x) => [x.date, x.commits, x.additions, x.deletions])} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Change-risk trend" subtitle="Heuristic score per commit, oldest → newest" icon={<Flame className="h-4 w-4" />} />
          <div className="p-4">
            <div className="h-52">
              <ResponsiveContainer>
                <LineChart data={d.riskTrend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="shortSha" {...AXIS} />
                  <YAxis domain={[0, 100]} {...AXIS} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#40E0D0", strokeOpacity: 0.3 }} />
                  <Line type="monotone" dataKey="score" name="Risk score" stroke={SERIES} strokeWidth={2} dot={(p: { cx?: number; cy?: number; payload?: { score: number; sha: string } }) => <circle key={p.payload?.sha} cx={p.cx} cy={p.cy} r={4} fill={scoreColor(p.payload?.score ?? 0)} stroke="#101E29" strokeWidth={2} />} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ChartTable columns={["Commit", "Score"]} rows={d.riskTrend.map((x) => [x.shortSha, x.score])} />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Code churn heatmap" subtitle="Lines changed per file per commit (top files by churn)" icon={<Flame className="h-4 w-4" />} />
        <div className="overflow-x-auto p-4">
          <table className="border-separate border-spacing-[3px] text-[10.5px]">
            <thead>
              <tr>
                <th />
                {(d.churnHeatmap[0]?.byCommit ?? []).map((c) => (
                  <th key={c.sha} className="px-0.5 font-mono font-normal text-ink-3" style={{ writingMode: "vertical-rl" }}>{short(c.sha)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.churnHeatmap.map((row) => (
                <tr key={row.path}>
                  <td className="max-w-[240px] truncate pr-2 text-right font-mono text-ink-2" title={row.path}>{row.path}</td>
                  {row.byCommit.map((c) => (
                    <td key={c.sha}>
                      <button
                        title={`${row.path} @ ${short(c.sha)}: ${c.churn} lines`}
                        aria-label={`${row.path} at ${short(c.sha)}: ${c.churn} lines changed`}
                        onClick={() => c.churn && go("/timeline", { commit: c.sha })}
                        className="block h-5 w-5 rounded-[3px]"
                        style={{ background: c.churn ? `rgba(64,224,208,${0.15 + 0.85 * Math.sqrt(c.churn / maxChurn)})` : "rgba(255,255,255,0.03)" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-3">
            <span>0</span>
            <span className="h-2 w-24 rounded" style={{ background: "linear-gradient(90deg, rgba(64,224,208,0.15), rgba(64,224,208,1))" }} />
            <span>{maxChurn} lines</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Hotspots · file modification leaderboard" subtitle="Frequently modified files with elevated heuristic risk" icon={<Flame className="h-4 w-4" />} />
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-2"><tr><th className="px-4 py-2">File</th><th>Changes</th><th>Churn</th><th>Avg risk</th><th className="px-4">Max risk</th></tr></thead>
            <tbody>
              {d.hotspots.map((f) => (
                <tr key={f.path} className="border-t border-line">
                  <td className="max-w-[320px] truncate px-4 py-2 font-mono text-xs text-ink">{f.path}</td>
                  <td className="font-mono text-xs">{f.changes}</td>
                  <td className="font-mono text-xs">{f.churn}</td>
                  <td><ScoreBadge score={f.avgRisk} /></td>
                  <td className="px-4"><ScoreBadge score={f.maxRisk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Contributor activity" subtitle="Commits per contributor" icon={<Users className="h-4 w-4" />} />
            <div className="p-4">
              <div style={{ height: Math.max(120, d.contributors.length * 30) }}>
                <ResponsiveContainer>
                  <BarChart data={d.contributors} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="2 4" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} {...AXIS} />
                    <YAxis type="category" dataKey="name" width={100} {...AXIS} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(64,224,208,0.05)" }} />
                    <Bar dataKey="commits" name="Commits" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartTable columns={["Contributor", "Commits", "+", "−"]} rows={d.contributors.map((c) => [c.name, c.commits, c.additions, c.deletions])} />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Language distribution" subtitle="Bytes per language (GitHub)" icon={<Languages className="h-4 w-4" />} />
            <div className="space-y-2 p-4">
              {d.languageBreakdown ? (() => {
                const total = d.languageBreakdown.reduce((s, l) => s + l.bytes, 0);
                return d.languageBreakdown.slice(0, 8).map((l) => (
                  <div key={l.language} title={`${l.bytes.toLocaleString()} bytes`}>
                    <div className="flex justify-between text-xs"><span className="text-ink">{l.language}</span><span className="font-mono text-ink-2">{((l.bytes / total) * 100).toFixed(1)}%</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${(l.bytes / total) * 100}%`, background: SERIES }} /></div>
                  </div>
                ));
              })() : <p className="text-sm text-ink-3">Language data unavailable.</p>}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {([
          ["Test-related changes", d.testChanges, TestTube2, "No test files changed in range."],
          ["Dependency manifest changes", d.manifestChanges, Package, "No manifest changes."],
          ["Configuration changes", d.configChanges, Settings2, "No configuration changes."],
        ] as const).map(([title, list, Icon, empty]) => (
          <Panel key={title}>
            <PanelHeader title={title} icon={<Icon className="h-4 w-4" />} />
            <ul className="max-h-48 space-y-1 overflow-y-auto p-4 text-xs">
              {list.length === 0 && <li className="text-ink-3">{empty}</li>}
              {list.map((x, i) => (
                <li key={i} className="flex gap-2"><button className="font-mono text-cyan hover:underline" onClick={() => go("/timeline", { commit: x.sha })}>{short(x.sha)}</button><span className="truncate font-mono text-ink-2">{x.path}</span></li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
