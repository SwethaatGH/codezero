import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, FileJson, FileText, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { InvestigationReport } from "@code-zero/shared";
import { FINDING_STATUS_LABELS, MODE_LABELS } from "@code-zero/shared";
import { api } from "../lib/api";
import { qk, useReports } from "../lib/queries";
import { useUI } from "../lib/store";
import { cn, fmtDate, relTime } from "../lib/utils";
import { Badge, Button, DetectionBadge, EmptyState, ErrorState, FindingBadge, PageTitle, Panel, PanelHeader, ScoreBadge, Sha, Skeleton } from "../components/ui";
import { EvidenceList, InvestigationGate, MiniDiff, useActiveInvestigation } from "../components/investigation";

export default function Reports() {
  return (
    <>
      <PageTitle themed="Investigation Reports" technical="Medical records" description="Reports are assembled strictly from stored analysis, AI output and treatments. Incomplete investigations produce explicitly incomplete reports." />
      <InvestigationGate need="any">{() => <ReportsView />}</InvestigationGate>
    </>
  );
}

function ReportsView() {
  const { inv } = useActiveInvestigation();
  const reports = useReports(inv?.id);
  const qc = useQueryClient();
  const notify = useUI((s) => s.notify);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createReport(inv!.id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.reports(inv!.id) });
      void qc.invalidateQueries({ queryKey: qk.investigation(inv!.id) });
      setSelectedId(r.id);
      toast.success("Medical record generated");
      notify({ title: "Report generated", body: r.title, tone: "success", href: `/reports?inv=${inv!.id}` });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const current = (reports.data ?? []).find((r) => r.id === selectedId) ?? reports.data?.[0];
  const full = useQuery({ queryKey: ["report", current?.id], queryFn: () => api.report(current!.id), enabled: !!current, initialData: current });

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <div className="no-print space-y-3">
        <Button className="w-full" variant="primary" icon={<FileText className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()}>
          {reports.data?.length ? "Regenerate report" : "Generate report"}
        </Button>
        {inv?.status !== "completed" && <p className="text-xs text-warn">Investigation is {inv?.status}; the report will be marked incomplete and contain no findings.</p>}
        <Panel>
          <PanelHeader title="Saved reports" subtitle={inv?.name} />
          {reports.isLoading ? <Skeleton className="m-3 h-24" /> : reports.data?.length === 0 ? (
            <EmptyState title="No reports yet" className="py-6" />
          ) : (
            <ul className="divide-y divide-line">
              {(reports.data ?? []).map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelectedId(r.id)} className={cn("w-full px-4 py-2.5 text-left hover:bg-white/[0.02]", current?.id === r.id && "bg-cyan/[0.06]")}>
                    <div className="font-mono text-xs text-cyan">{r.id}</div>
                    <div className="text-xs text-ink-2">{fmtDate(r.createdAt)} · {r.complete ? "complete" : "incomplete"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {full.isError ? <ErrorState error={full.error} /> : full.data ? <ReportPreview r={full.data} /> : <Panel><EmptyState icon={<FileText className="h-5 w-5" />} title="Generate a medical record" description="Includes repository identity, commit range, symptoms, risk indicators, suspects, evidence, AI analysis, proposed fixes, verification and limitations." /></Panel>}
    </div>
  );
}

function Section({ title, children, defaultOpen = true, count }: { title: string; children: ReactNode; defaultOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-line">
      <button className="no-print flex w-full items-center gap-2 px-5 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-ink-3" /> : <ChevronRight className="h-4 w-4 text-ink-3" />}
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.1em]">{title}</h3>
        {count !== undefined && <span className="font-mono text-xs text-ink-3">{count}</span>}
      </button>
      <h3 className="hidden px-5 pt-3 font-display text-sm font-semibold uppercase print:block">{title}</h3>
      <div className={cn("px-5 pb-4", !open && "hidden print:block")}>{children}</div>
    </section>
  );
}

function ReportPreview({ r }: { r: InvestigationReport }) {
  return (
    <Panel className="print-area overflow-hidden">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <a href={api.exportUrl(r.id, "markdown")} download><Button size="sm" icon={<Download className="h-3.5 w-3.5" />}>Markdown</Button></a>
        <a href={api.exportUrl(r.id, "json")} download><Button size="sm" icon={<FileJson className="h-3.5 w-3.5" />}>JSON</Button></a>
        <Button size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>Print / PDF</Button>
        <span className="ml-auto flex items-center gap-1 text-xs text-ink-3"><RefreshCw className="h-3 w-3" /> generated {relTime(r.createdAt)}</span>
      </div>
      <div className="p-5">
        {r.repository.isDemo && <div className="mb-3 rounded-md border border-warn/40 bg-warn/[0.07] px-3 py-1.5 text-xs font-semibold text-warn">SIMULATED DEMO DATA</div>}
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal">Medical record · investigation report</div>
        <h2 className="mt-1 font-display text-2xl font-semibold">{r.title}</h2>
        <div className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-2 sm:grid-cols-2">
          <div>Repository: <span className="text-ink">{r.repository.fullName}</span></div>
          <div>Investigation ID: <code className="font-mono text-ink">{r.investigationId}</code></div>
          <div>Date: <span className="text-ink">{fmtDate(r.createdAt)}</span></div>
          <div>Mode: <span className="text-ink">{MODE_LABELS[r.mode].title}</span> · branch <span className="font-mono text-ink">{r.branch}</span></div>
          <div>Commit range: <Sha sha={r.commitRange.from} /> … <Sha sha={r.commitRange.to} /> ({r.commitRange.count})</div>
          <div>Status: {r.complete ? <Badge tone="healthy">Complete</Badge> : <Badge tone="warn">Incomplete</Badge>}</div>
        </div>
        {r.riskIndicators.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            {r.riskIndicators.map((i) => (
              <div key={i.label} className="rounded-lg border border-line bg-obsidian/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-ink-3">{i.label}</div>
                <div className="font-display text-lg font-semibold">{i.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {r.symptoms && <Section title="Reported symptoms"><pre className="whitespace-pre-wrap rounded-lg bg-obsidian/60 p-3 font-mono text-xs text-ink">{r.symptoms}</pre></Section>}
      <Section title="Summary">
        <ul className="space-y-1 text-sm text-ink-2">{r.summary.map((s, i) => <li key={i}>• {s}</li>)}</ul>
      </Section>
      <Section title="Suspicious commits" count={r.suspiciousCommits.length}>
        {r.suspiciousCommits.length === 0 ? <p className="text-sm text-ink-3">None reported.</p> : (
          <ol className="space-y-3">
            {r.suspiciousCommits.map((c, i) => (
              <li key={c.sha} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-3">#{i + 1}</span>
                  <Sha sha={c.sha} />
                  <span className="text-sm text-ink">{c.message}</span>
                  <ScoreBadge score={c.score} />
                  <FindingBadge status={c.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.signals.map((s) => <span key={s.label} className="inline-flex items-center gap-1 text-[11px] text-ink-2">{s.label} <span className="font-mono text-warn">+{s.weight}</span><DetectionBadge detection={s.detection} /></span>)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Evidence" count={r.evidence.length} defaultOpen={false}><EvidenceList evidence={r.evidence} /></Section>
      <Section title="AI analysis" count={r.aiAnalyses.length}>
        {r.aiAnalyses.length === 0 ? <p className="text-sm text-ink-3">No Gemma analyses were run.</p> : r.aiAnalyses.map((a) => (
          <div key={a.id} className="mb-3 rounded-lg border border-line p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <strong className="text-ink">{a.task}</strong>
              {a.commitSha && <Sha sha={a.commitSha} />}
              {a.source === "live" ? <Badge tone="bio">live · {a.model}</Badge> : <Badge tone="warn">prerecorded demo</Badge>}
            </div>
            <p className="text-sm text-ink-2">{a.summary}</p>
            {a.hypotheses.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">Hypotheses & alternatives</div>
                <ul className="text-sm text-ink-2">{a.hypotheses.map((h) => <li key={h.title}>• <strong className="text-ink">{h.title}</strong> ({h.confidence}): {h.explanation}</li>)}</ul>
              </div>
            )}
            {a.suggestedTests.length > 0 && <div className="mt-2 text-xs text-ink-2">Suggested tests: {a.suggestedTests.map((t) => t.name).join(", ")}</div>}
          </div>
        ))}
      </Section>
      <Section title="Proposed fixes" count={r.patches.length} defaultOpen={false}>
        {r.patches.length === 0 ? <p className="text-sm text-ink-3">No treatments generated.</p> : r.patches.map((p) => (
          <div key={p.id} className="mb-3 overflow-hidden rounded-lg border border-line">
            <div className="flex items-center gap-2 px-3 py-2 text-sm">
              <strong>{p.title}</strong>
              <Badge tone="neutral">{p.strategy}</Badge>
              {p.verified ? <Badge tone="healthy"><ShieldCheck className="h-3 w-3" />verified</Badge> : <Badge tone="warn">UNVERIFIED</Badge>}
            </div>
            <div className="max-h-64 overflow-auto bg-obsidian/60"><MiniDiff patch={p.patch} /></div>
          </div>
        ))}
      </Section>
      <Section title="Verification" count={r.verification.length} defaultOpen={false}>
        {r.verification.length === 0 ? <p className="text-sm text-ink-3">No automated verification was run. Findings are unverified.</p> : (
          <ul className="space-y-1 text-xs text-ink-2">{r.verification.map((v) => <li key={v.id}><Sha sha={v.commitSha} /> {v.summary}</li>)}</ul>
        )}
      </Section>
      <Section title="Modified files & affected functions" defaultOpen={false}>
        <div className="grid gap-4 md:grid-cols-2">
          <ul className="space-y-0.5 font-mono text-xs text-ink-2">{r.modifiedFiles.map((f) => <li key={f}>{f}</li>)}</ul>
          <ul className="space-y-0.5 font-mono text-xs text-ink-2">{r.affectedFunctions.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      </Section>
      <Section title="Limitations">
        <ul className="space-y-1 text-sm text-ink-2">{r.limitations.map((l) => <li key={l}>• {l}</li>)}</ul>
        <p className="mt-3 text-xs text-ink-3">Status legend: {Object.values(FINDING_STATUS_LABELS).join(" · ")}</p>
      </Section>
    </Panel>
  );
}
