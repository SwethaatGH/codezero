import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, CheckCircle2, FlaskConical, GitCompare, Info, ListChecks, Network, ShieldCheck, Siren, TestTube2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Investigation } from "@code-zero/shared";
import { FINDING_STATUS_LABELS } from "@code-zero/shared";
import { api } from "../lib/api";
import { qk, useAIAnalyses, useTimeline } from "../lib/queries";
import { useUI } from "../lib/store";
import { cn, firstLine, fmtDate, short } from "../lib/utils";
import { Badge, Button, DetectionBadge, EmptyState, FindingBadge, PageTitle, Panel, PanelHeader, ScoreBadge, ScoreRing, Sha, SimulatedBanner, Skeleton } from "../components/ui";
import { EvidenceList, InvestigationGate, SignalList, useActiveInvestigation } from "../components/investigation";
import { SIGNAL_LABELS } from "../components/signal-labels";
import { AnalysisCard } from "./Gemma";

export default function Breakage() {
  return (
    <>
      <PageTitle themed="Breakage Detector" technical="Regression analysis engine" description="Deterministic signals rank suspicious commits; Gemma explains them. Scores are transparent heuristics — never a probability of failure." />
      <InvestigationGate>{(inv) => <BreakageView inv={inv} />}</InvestigationGate>
    </>
  );
}

function BreakageView({ inv }: { inv: Investigation }) {
  const { commitSha, selectCommit, go } = useActiveInvestigation();
  const tl = useTimeline(inv);
  const ai = useAIAnalyses(inv.id);
  const qc = useQueryClient();
  const level = useUI((s) => s.level);

  const focus = inv.findings.find((f) => commitSha && f.commitSha.startsWith(commitSha)) ?? inv.findings[0];
  const commit = focus ? tl.data?.commits.find((c) => c.sha === focus.commitSha) : undefined;
  const assessment = focus ? tl.data?.assessments.find((a) => a.commitSha === focus.commitSha) : undefined;
  const diagnosis = useMemo(() => (ai.data ?? []).find((a) => a.commitSha === focus?.commitSha && (a.task === "root-cause" || a.task === "commit-investigation")), [ai.data, focus]);

  const runAI = useMutation({
    mutationFn: (task: "root-cause" | "tests") => api.aiAnalyze({ investigationId: inv.id, task, commitSha: focus!.commitSha, level }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: qk.ai(inv.id) });
      toast.success(a.task === "tests" ? "Regression tests generated" : "Diagnosis ready", { description: a.source === "prerecorded-demo" ? "Prerecorded demo analysis (Gemma unavailable)" : `Live: ${a.model}` });
      if (a.task === "tests") go("/gemma", { commit: a.commitSha });
    },
    onError: (e) => toast.error("Gemma analysis failed", { description: (e as Error).message }),
  });

  if (tl.isLoading) return <Skeleton className="h-96" />;
  if (inv.findings.length === 0)
    return <Panel><EmptyState icon={<Siren className="h-5 w-5" />} title={inv.mode === "exploration" ? "Exploration mode" : "No suspects"} description={inv.mode === "exploration" ? "Exploration mode browses history without assuming a regression. Start a Quick Scan or Regression Hunt to rank suspects." : "No commit in range produced a non-zero heuristic risk score."} /></Panel>;

  const bisect = tl.data?.bisect;
  const parent = commit?.parents[0] ?? null;

  return (
    <div className="space-y-4">
      {inv.isDemo && <SimulatedBanner />}
      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        {/* Patient Zero */}
        <Panel glow={focus?.status === "test-confirmed" ? "crit" : undefined}>
          <PanelHeader title={focus?.rank === 1 ? "Patient Zero — suspected regression commit" : `Suspect #${focus?.rank} — candidate regression commit`} subtitle={<span>Status: <strong>{focus && FINDING_STATUS_LABELS[focus.status]}</strong></span>} icon={<Siren className="h-4 w-4 text-crit" />} />
          {focus && commit && (
            <div className="space-y-5 p-5">
              <div className="flex flex-wrap items-start gap-5">
                <ScoreRing score={focus.score} size={92} label="Heuristic risk score" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sha sha={commit.sha} />
                    <FindingBadge status={focus.status} />
                    {assessment && <Badge tone="neutral">{assessment.level} risk band</Badge>}
                  </div>
                  <h2 className="mt-2 font-display text-xl font-semibold leading-snug">{firstLine(commit.message)}</h2>
                  <p className="mt-1 text-xs text-ink-2">{commit.author.name} · {fmtDate(commit.date)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {focus.relevantFiles.map((f) => (
                      <Badge key={f} tone="cyan" className="font-mono">{f}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" icon={<GitCompare className="h-3.5 w-3.5" />} disabled={!parent} onClick={() => go("/divergence", { a: parent, b: commit.sha, commit: commit.sha })}>Open diff</Button>
                <Button size="sm" variant="outline" icon={<GitCompare className="h-3.5 w-3.5" />} disabled={!inv.knownGoodSha} title={inv.knownGoodSha ? "" : "Set a known good commit (Regression Hunt) to enable"} onClick={() => go("/divergence", { a: inv.knownGoodSha, b: commit.sha, commit: commit.sha })}>Compare vs known good</Button>
                <Button size="sm" variant="outline" icon={<Network className="h-3.5 w-3.5" />} onClick={() => go("/infection", { commit: commit.sha })}>View impact</Button>
                <Button size="sm" variant="outline" icon={<TestTube2 className="h-3.5 w-3.5" />} loading={runAI.isPending && runAI.variables === "tests"} onClick={() => runAI.mutate("tests")}>Generate tests</Button>
                <Button size="sm" variant="outline" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => go("/restore", { commit: commit.sha })}>Treatments</Button>
              </div>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">Risk factors</h3>
                {assessment && <SignalList assessment={assessment} />}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">AI diagnosis</h3>
                  <Button size="sm" variant={diagnosis ? "ghost" : "primary"} icon={<Brain className="h-3.5 w-3.5" />} loading={runAI.isPending && runAI.variables === "root-cause"} onClick={() => runAI.mutate("root-cause")}>
                    {diagnosis ? "Re-run" : "Ask Gemma"}
                  </Button>
                </div>
                {diagnosis ? <AnalysisCard analysis={diagnosis} compact /> : <p className="rounded-lg border border-dashed border-line-2 p-3 text-sm text-ink-3">No diagnosis yet. Gemma receives the risk signals, evidence IDs, diff excerpts and dependents for this commit.</p>}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">Supporting evidence</h3>
                <EvidenceList evidence={focus.evidence} onOpen={(e) => e.filePath && parent && go("/divergence", { a: parent, b: commit.sha, commit: commit.sha })} />
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2"><ListChecks className="h-3.5 w-3.5" /> Suggested verification steps</h3>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
                  {focus.verificationSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          {/* Leaderboard */}
          <Panel>
            <PanelHeader title="Suspicious commit leaderboard" subtitle="Top 5 candidates" icon={<Siren className="h-4 w-4" />} />
            <ol className="divide-y divide-line">
              {inv.findings.map((f) => {
                const c = tl.data?.commits.find((x) => x.sha === f.commitSha);
                const active = f.commitSha === focus?.commitSha;
                return (
                  <li key={f.id} className={cn("px-4 py-3", active && "bg-cyan/[0.05]")}>
                    <button className="flex w-full items-start gap-3 text-left" onClick={() => selectCommit(f.commitSha)} aria-current={active}>
                      <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-xs", f.rank === 1 ? "bg-crit/20 text-crit" : "bg-white/5 text-ink-2")}>{f.rank}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{f.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Sha sha={f.commitSha} />
                          <FindingBadge status={f.status} />
                        </div>
                      </div>
                      <ScoreBadge score={f.score} />
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1 pl-9">
                      <Button size="sm" variant="ghost" onClick={() => selectCommit(f.commitSha)}>Evidence</Button>
                      <Button size="sm" variant="ghost" disabled={!c?.parents[0]} onClick={() => go("/divergence", { a: c?.parents[0] ?? null, b: f.commitSha, commit: f.commitSha })}>Diff</Button>
                      <Button size="sm" variant="ghost" onClick={() => go("/infection", { commit: f.commitSha })}>Impact</Button>
                      <Button size="sm" variant="ghost" onClick={() => go("/gemma", { commit: f.commitSha })}>Ask Gemma</Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>

          {/* Verification */}
          <Panel>
            <PanelHeader title="Verification" subtitle={inv.isDemo ? "Deterministic test harness (controlled demo only)" : "No repository code is executed by CODE ZERO"} icon={<ShieldCheck className="h-4 w-4" />} />
            <div className="p-4">
              {bisect ? (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">
                    Bisected in <strong className="text-ink">{bisect.steps.length}</strong> steps.{" "}
                    {bisect.firstBadSha ? (
                      <>First failing commit: <Sha sha={bisect.firstBadSha} />; last passing: <Sha sha={bisect.lastGoodSha} />.</>
                    ) : (
                      "No failing commit in range."
                    )}
                  </p>
                  <ul className="space-y-2">
                    {bisect.verification.filter((v) => v.results.length).map((v) => (
                      <li key={v.id} className="rounded-lg border border-line bg-obsidian/40 p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <Sha sha={v.commitSha} />
                          <span className="text-ink-2">{v.summary}</span>
                        </div>
                        <ul className="mt-1.5 space-y-0.5">
                          {v.results.map((r) => (
                            <li key={r.testName} className="flex items-start gap-1.5 text-xs">
                              {r.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-healthy" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-crit" />}
                              <span className={r.passed ? "text-ink-2" : "text-ink"}>{r.testName}{r.message && <span className="text-crit"> — {r.message}</span>}</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-ink-2">
                  <p className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan" /> Automated test execution is not available for imported repositories. Findings remain <strong>unverified hypotheses</strong> until you run the suggested steps locally.</p>
                  <p className="text-xs text-ink-3">Running untrusted code requires an isolated, resource-limited container with explicit authorization — see Known Limitations in the docs.</p>
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-1.5 text-[11px]">
                {Object.entries(FINDING_STATUS_LABELS).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1.5 text-ink-2">
                    <FindingBadge status={k as keyof typeof FINDING_STATUS_LABELS} />
                    <span className="sr-only">{v}</span>
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="How the score is built" subtitle="Each signal has a cap; the total is clamped to 100" icon={<Info className="h-4 w-4" />} />
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(SIGNAL_LABELS).map(([k, s]) => (
                  <tr key={k} className="border-t border-line" title={s.explain}>
                    <td className="px-4 py-1.5 text-ink">{s.label}</td>
                    <td className="py-1.5"><DetectionBadge detection={s.detection} /></td>
                    <td className="px-4 py-1.5 text-right font-mono text-ink-2">≤ {s.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
      <p className="text-center text-xs text-ink-3">Focus: {short(focus?.commitSha)} · Shift focus by selecting a suspect.</p>
    </div>
  );
}
