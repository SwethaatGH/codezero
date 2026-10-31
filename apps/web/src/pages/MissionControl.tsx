import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Brain, ExternalLink, FileText, FlaskConical, GitBranch, GitCompare, GitFork, Network, Play, Radar, ShieldCheck, Siren, Star, Users, Waypoints } from "lucide-react";
import type { Investigation } from "@code-zero/shared";
import { MODE_LABELS } from "@code-zero/shared";
import { api } from "../lib/api";
import { useAIAnalyses, useAIStatus, useHealth, useInvestigations, useTimeline } from "../lib/queries";
import { cn, fmtDay, fmtNum, firstLine, LEVEL_COLOR, relTime, scoreColor } from "../lib/utils";
import { Badge, Button, EmptyState, FindingBadge, PageTitle, Panel, PanelHeader, ScoreBadge, ScoreRing, Sha, SimulatedBanner, Skeleton, Stat, StatusDot } from "../components/ui";
import { InvestigationGate, PipelineProgress, useActiveInvestigation, useLaunchDemo } from "../components/investigation";
import { AXIS, ChartTable, ChartTooltip, GRID, SERIES } from "../components/charts";
import { Logo } from "../components/layout/Logo";

export default function MissionControl() {
  const { invId, inv } = useActiveInvestigation();
  if (!invId) return <Welcome />;
  return (
    <>
      <PageTitle themed="Mission Control" technical="Repository overview" description="Diagnostic summary of the patient (repository) under investigation. Every number is computed from analyzed commits." />
      <InvestigationGate need="any">{(i) => (i.status === "completed" ? <Dashboard inv={i} /> : <Running inv={inv ?? i} />)}</InvestigationGate>
    </>
  );
}

function Running({ inv }: { inv: Investigation }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <PipelineProgress inv={inv} />
      <RecentInvestigations />
    </div>
  );
}

function Welcome() {
  const demo = useLaunchDemo();
  const { go } = useActiveInvestigation();
  return (
    <div className="mx-auto max-w-5xl py-6 md:py-12">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-panel-2/80 to-lab/80 p-8 md:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-bio/10 blur-3xl" />
        <div className="relative">
          <Logo />
          <h1 className="mt-8 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl">
            Find <span className="text-gradient">Patient Zero</span> in your codebase.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-2">
            CODE ZERO treats regressions like infections. Import a GitHub repository, rank suspicious commits with transparent risk signals, trace the potential spread through a real dependency graph, and let Gemma 4 explain the evidence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" variant="primary" icon={<Play className="h-4 w-4" />} loading={demo.isPending} onClick={() => demo.mutate()}>
              Launch Demo Investigation
            </Button>
            <Button size="lg" icon={<Radar className="h-4 w-4" />} onClick={() => go("/portal")}>
              Import a GitHub repository
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-3">The demo runs fully offline on a simulated repository with a deliberately introduced regression.</p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { icon: Waypoints, t: "Temporal Timeline", d: "Replay commit history with risk scores, filters and playback." },
          { icon: Network, t: "Infection Map", d: "AST-derived imports and calls show where a change could propagate." },
          { icon: Brain, t: "Gemma Intelligence", d: "Evidence-cited diagnoses, semantic diffs, tests and treatments." },
        ].map((f) => (
          <Panel key={f.t} className="p-5">
            <f.icon className="h-5 w-5 text-bio" />
            <h3 className="mt-3 font-display font-semibold">{f.t}</h3>
            <p className="mt-1 text-sm text-ink-2">{f.d}</p>
          </Panel>
        ))}
      </div>
      <div className="mt-6">
        <RecentInvestigations />
      </div>
    </div>
  );
}

function Dashboard({ inv }: { inv: Investigation }) {
  const { go } = useActiveInvestigation();
  const tl = useTimeline(inv);
  const health = useHealth(inv);
  const ai = useAIAnalyses(inv.id);
  const aiStatus = useAIStatus();
  const repo = useQuery({ queryKey: ["repo", inv.repositoryId], queryFn: () => api.repository(inv.repositoryId) });

  const m = useMemo(() => {
    if (!tl.data) return null;
    const scores = tl.data.assessments.map((a) => a.score);
    const files = new Set(tl.data.commits.flatMap((c) => c.files.map((f) => f.path)));
    const fns = new Set(tl.data.assessments.flatMap((a) => a.modifiedFunctions.map((f) => f.id)));
    const dist = (["low", "moderate", "elevated", "high"] as const).map((level) => ({
      level,
      count: tl.data!.assessments.filter((a) => a.level === level).length,
    }));
    return {
      commits: tl.data.commits.length,
      suspicious: scores.filter((s) => s >= 40).length,
      files: files.size,
      functions: fns.size,
      peak: scores.length ? Math.max(...scores) : null,
      mean: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      dist,
    };
  }, [tl.data]);

  const bisect = tl.data?.bisect;
  const verification = bisect ? (bisect.firstBadSha ? { label: "Regression reproduced", tone: "#FF5C7A" } : { label: "No failing commit", tone: "#39D98A" }) : { label: "Not run", tone: "#8C9BA8" };
  const top = inv.findings[0];
  const topCommit = top ? tl.data?.commits.find((c) => c.sha === top.commitSha) : undefined;
  const h = health.data;

  return (
    <div className="space-y-4">
      {inv.isDemo && <SimulatedBanner />}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        {/* Repository identity */}
        <Panel className="p-5">
          {repo.isLoading ? (
            <Skeleton className="h-28" />
          ) : repo.data ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal">Patient · repository</div>
                <h2 className="mt-1 truncate font-display text-xl font-semibold">
                  <span className="text-ink-2">{repo.data.owner}/</span>
                  {repo.data.name}
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-ink-2">{repo.data.description ?? "No description"}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
                  <span className="flex items-center gap-1"><StatusDot tone="cyan" />{repo.data.primaryLanguage ?? "Unknown language"}</span>
                  <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5" />{fmtNum(repo.data.stars)}</span>
                  <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5" />{fmtNum(repo.data.forks)}</span>
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{fmtNum(repo.data.contributorsCount)} contributors</span>
                  <span className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" />{repo.data.defaultBranch}</span>
                  <span className="flex items-center gap-1">Latest <Sha sha={repo.data.latestCommitSha} /></span>
                </div>
              </div>
              {repo.data.htmlUrl && (
                <a href={repo.data.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan hover:underline">
                  GitHub <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Repository metadata unavailable.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <Button size="sm" variant="primary" icon={<Radar className="h-3.5 w-3.5" />} onClick={() => go("/portal")}>Start investigation</Button>
            <Button size="sm" icon={<Waypoints className="h-3.5 w-3.5" />} onClick={() => go("/timeline")}>Explore timeline</Button>
            <Button size="sm" icon={<GitCompare className="h-3.5 w-3.5" />} onClick={() => go("/divergence", top && topCommit?.parents[0] ? { a: topCommit.parents[0], b: top.commitSha } : {})}>Compare commits</Button>
            <Button size="sm" icon={<Network className="h-3.5 w-3.5" />} onClick={() => go("/infection", top ? { commit: top.commitSha } : {})}>View Infection Map</Button>
            <Button size="sm" icon={<Brain className="h-3.5 w-3.5" />} onClick={() => go("/gemma", top ? { commit: top.commitSha } : {})}>Ask Gemma</Button>
            <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => go("/reports")}>Generate report</Button>
          </div>
        </Panel>

        {/* Patient Zero headline */}
        <Panel className="p-5" glow={top ? (top.status === "test-confirmed" ? "crit" : undefined) : undefined}>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-crit">Patient Zero — suspected regression commit</div>
          {top && topCommit ? (
            <div className="mt-3 flex items-start gap-4">
              <ScoreRing score={top.score} size={76} label="Heuristic risk" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Sha sha={top.commitSha} />
                  <FindingBadge status={top.status} />
                </div>
                <h3 className="mt-1.5 font-display text-lg font-semibold leading-snug">{firstLine(topCommit.message)}</h3>
                <p className="mt-1 text-xs text-ink-2">
                  {topCommit.author.name} · {relTime(topCommit.date)} · {top.relevantFiles.slice(0, 3).join(", ")}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" icon={<Siren className="h-3.5 w-3.5" />} onClick={() => go("/breakage", { commit: top.commitSha })}>Inspect evidence</Button>
                  <Button size="sm" variant="ghost" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => go("/restore", { commit: top.commitSha })}>Treatments</Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-2">{inv.mode === "exploration" ? "Exploration mode does not rank suspects; browse the timeline instead." : "No commit produced a non-zero risk score."}</p>
          )}
        </Panel>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {m ? (
          <>
            <Stat label="Commits analyzed" value={m.commits} icon={<Activity className="h-3.5 w-3.5" />} />
            <Stat label="Suspicious" value={m.suspicious} sub="score ≥ 40" tone={m.suspicious ? "#FFCB6B" : undefined} />
            <Stat label="Files modified" value={m.files} />
            <Stat label="Functions modified" value={m.functions} sub="AST-detected" />
            <Stat label="Peak risk" value={m.peak ?? "—"} sub={`mean ${m.mean ?? "—"} · heuristic`} tone={m.peak !== null ? scoreColor(m.peak) : undefined} />
            <Stat label="AI analyses" value={ai.data?.length ?? 0} sub={aiStatus.data?.state === "connected" ? "Gemma online" : "Gemma offline"} icon={<Brain className="h-3.5 w-3.5" />} />
            <Stat label="Verification" value={<span className="text-base">{verification.label}</span>} tone={verification.tone} icon={<ShieldCheck className="h-3.5 w-3.5" />} sub={inv.isDemo ? "demo harness" : "no code executed"} />
            <Stat label="Test signals" value={h ? `${new Set(h.testChanges.map((t) => t.sha)).size}/${m.commits}` : "—"} sub="commits touching tests" />
          </>
        ) : (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Commit activity" subtitle="Commits per day in the analyzed range" icon={<Activity className="h-4 w-4" />} />
          <div className="p-4">
            {h ? (
              <>
                <div className="h-56">
                  <ResponsiveContainer>
                    <AreaChart data={h.commitActivity} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="actFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor={SERIES} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDay} />
                      <YAxis allowDecimals={false} {...AXIS} />
                      <Tooltip content={<ChartTooltip format={(l) => fmtDay(String(l))} />} cursor={{ stroke: "#40E0D0", strokeOpacity: 0.3 }} />
                      <Area type="monotone" dataKey="commits" name="Commits" stroke={SERIES} strokeWidth={2} fill="url(#actFill)" dot={{ r: 3, fill: SERIES, stroke: "#101E29", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <ChartTable columns={["Date", "Commits", "Additions", "Deletions"]} rows={h.commitActivity.map((d) => [d.date, d.commits, d.additions, d.deletions])} />
              </>
            ) : (
              <Skeleton className="h-56" />
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Risk distribution" subtitle="Commits per heuristic risk band" icon={<Siren className="h-4 w-4" />} />
          <div className="p-4">
            {m ? (
              <>
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={m.dist} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="level" {...AXIS} tickFormatter={(l: string) => ({ low: "Low <20", moderate: "Mod 20–39", elevated: "Elev 40–59", high: "High ≥60" })[l] ?? l} />
                      <YAxis allowDecimals={false} {...AXIS} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(64,224,208,0.05)" }} />
                      <Bar dataKey="count" name="Commits" radius={[4, 4, 0, 0]} maxBarSize={38}>
                        {m.dist.map((d) => (
                          <Cell key={d.level} fill={LEVEL_COLOR[d.level]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ChartTable columns={["Band", "Commits"]} rows={m.dist.map((d) => [d.level, d.count])} />
              </>
            ) : (
              <Skeleton className="h-56" />
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Top suspicious commits" subtitle="Ranked by heuristic score" icon={<Siren className="h-4 w-4" />} actions={<Button size="sm" variant="ghost" onClick={() => go("/breakage")}>All</Button>} />
          <ul className="divide-y divide-line">
            {inv.findings.length === 0 && <li className="p-4 text-sm text-ink-3">No ranked suspects.</li>}
            {inv.findings.map((f) => (
              <li key={f.id}>
                <button onClick={() => go("/breakage", { commit: f.commitSha })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02]">
                  <span className="w-5 font-mono text-xs text-ink-3">#{f.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{f.title}</div>
                    <div className="mt-0.5"><Sha sha={f.commitSha} /></div>
                  </div>
                  <ScoreBadge score={f.score} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Most frequently changed files" subtitle="Change count · max commit risk" icon={<FileText className="h-4 w-4" />} actions={<Button size="sm" variant="ghost" onClick={() => go("/health")}>Health</Button>} />
          <ul className="space-y-2.5 p-4">
            {(h?.hotspots ?? []).slice(0, 6).map((f) => {
              const max = h!.hotspots[0].changes;
              return (
                <li key={f.path}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-ink">{f.path}</span>
                    <span className="shrink-0 font-mono text-ink-2">{f.changes}× · <span style={{ color: scoreColor(f.maxRisk) }}>{f.maxRisk}</span></span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-cyan/70" style={{ width: `${(f.changes / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
            {!h && <Skeleton className="h-40" />}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Investigation progress" subtitle="Pipeline status" icon={<Radar className="h-4 w-4" />} />
          <div className="p-4">
            <MacroPipeline inv={inv} aiCount={ai.data?.length ?? 0} />
            <div className="mt-4 text-xs text-ink-2">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Recent analysis activity</div>
              <ul className="space-y-1">
                {[
                  ...(ai.data ?? []).slice(0, 3).map((a) => ({ at: a.createdAt, text: `Gemma ${a.task} on ${a.commitSha?.slice(0, 7) ?? "investigation"}${a.source === "prerecorded-demo" ? " (prerecorded)" : ""}` })),
                  ...inv.progress.logs.slice(-3).reverse().map((l) => ({ at: l.at, text: l.message })),
                ]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 5)
                  .map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-14 shrink-0 text-ink-3">{relTime(e.at)}</span>
                      <span className="truncate">{e.text}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader title="Repository health summary" subtitle="Derived from analyzed commits only" icon={<ShieldCheck className="h-4 w-4" />} />
          <ul className="space-y-2 p-4 text-sm text-ink-2">
            {(h?.summary ?? []).map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-bio" />
                {s}
              </li>
            ))}
          </ul>
        </Panel>
        <RecentInvestigations />
      </div>
    </div>
  );
}

export function MacroPipeline({ inv, aiCount }: { inv: Investigation; aiCount: number }) {
  const st = (stages: string[]) => {
    const s = inv.progress.stages.filter((x) => stages.includes(x.stage));
    if (s.some((x) => x.status === "error")) return "error";
    if (s.every((x) => x.status === "done" || x.status === "skipped")) return "done";
    if (s.some((x) => x.status === "running" || x.status === "done")) return "running";
    return "pending";
  };
  const steps = [
    { label: "Import", status: st(["connect", "metadata", "commits"]) },
    { label: "Parse", status: st(["diffs", "parse"]) },
    { label: "Compare", status: st(["dependencies"]) },
    { label: "Detect", status: st(["risk"]) },
    { label: "Diagnose", status: aiCount > 0 ? "done" : st(["ai-context"]) === "done" ? "ready" : "pending" },
    { label: "Report", status: inv.reportIds.length > 0 ? "done" : "pending" },
  ];
  const color = (s: string) => (s === "done" ? "border-healthy/50 bg-healthy/10 text-healthy" : s === "running" ? "border-cyan/50 bg-cyan/10 text-cyan" : s === "error" ? "border-crit/50 bg-crit/10 text-crit" : s === "ready" ? "border-warn/40 bg-warn/[0.07] text-warn" : "border-line-2 text-ink-3");
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Investigation pipeline">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className={cn("rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider", color(s.status))} title={s.status === "ready" ? "Ready — run a Gemma analysis" : s.status}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-ink-3">→</span>}
        </li>
      ))}
    </ol>
  );
}

function RecentInvestigations() {
  const invs = useInvestigations();
  const { go } = useActiveInvestigation();
  return (
    <Panel>
      <PanelHeader title="Recent investigations" subtitle="Saved case files" icon={<FileText className="h-4 w-4" />} actions={<Button size="sm" variant="ghost" onClick={() => go("/saved")}>All</Button>} />
      {invs.data?.length === 0 ? (
        <EmptyState title="No investigations yet" description="Start one from the Time Portal or launch the demo." />
      ) : (
        <ul className="divide-y divide-line">
          {(invs.data ?? []).slice(0, 5).map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
              <StatusDot tone={i.status === "completed" ? "healthy" : i.status === "running" ? "cyan" : i.status === "failed" ? "crit" : "unknown"} pulse={i.status === "running"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{i.name}</div>
                <div className="truncate text-xs text-ink-3">
                  {i.repoFullName} · {MODE_LABELS[i.mode].title} · {i.commitRange.count} commits · {relTime(i.updatedAt)}
                </div>
              </div>
              {i.findings[0] && <ScoreBadge score={i.findings[0].score} />}
              {i.isDemo && <Badge tone="warn">demo</Badge>}
              <Button size="sm" variant="ghost" onClick={() => go("/mission", { inv: i.id, commit: null, a: null, b: null })}>Open</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
