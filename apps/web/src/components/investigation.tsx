import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bookmark, BookmarkCheck, Brain, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDashed, FileCode2, GitCompare, Loader2, Network, Play, Radar, RotateCw, Square, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Commit, EvidenceReference, Investigation, RiskAssessment, StageState } from "@code-zero/shared";
import { SIGNAL_LABELS } from "./signal-labels";
import { api } from "../lib/api";
import { qk, useInvestigation } from "../lib/queries";
import { useSelection } from "../lib/selection";
import { useMotionOff } from "../lib/store";
import { cn, fmtDate, firstLine, short } from "../lib/utils";
import { Badge, Button, DetectionBadge, EmptyState, ErrorState, Panel, PanelHeader, ScoreBadge, Sha, SimulatedBanner, Skeleton } from "./ui";

export function useActiveInvestigation() {
  const sel = useSelection();
  const q = useInvestigation(sel.invId);
  return { ...sel, inv: q.data, query: q };
}

export function useLaunchDemo() {
  const { go } = useSelection();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.launchDemo,
    onSuccess: (inv) => {
      qc.setQueryData(qk.investigation(inv.id), inv);
      void qc.invalidateQueries({ queryKey: qk.investigations });
      toast.success("Demo investigation launched", { description: "SIMULATED orbit-checkout repository" });
      go("/mission", { inv: inv.id, commit: null, a: null, b: null });
    },
    onError: (e) => toast.error("Could not launch demo", { description: (e as Error).message }),
  });
}

/** Renders children only for a completed investigation; otherwise a clear empty/progress/error state. */
export function InvestigationGate({ children, need = "completed" }: { children: (inv: Investigation) => ReactNode; need?: "completed" | "any" }) {
  const { inv, query, invId, go } = useActiveInvestigation();
  const demo = useLaunchDemo();
  const qc = useQueryClient();
  const resume = useMutation({
    mutationFn: () => api.analyze(invId!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.investigation(invId!) }),
    onError: (e) => toast.error((e as Error).message),
  });

  if (!invId)
    return (
      <Panel className="mx-auto mt-10 max-w-2xl">
        <EmptyState
          icon={<Radar className="h-5 w-5" />}
          title="No patient under investigation"
          description="Import a GitHub repository in the Time Portal, or launch the offline demo investigation to explore every module."
          action={
            <div className="flex gap-2">
              <Button variant="primary" icon={<Play className="h-4 w-4" />} loading={demo.isPending} onClick={() => demo.mutate()}>
                Launch Demo Investigation
              </Button>
              <Button onClick={() => go("/portal")}>Open Time Portal</Button>
            </div>
          }
        />
      </Panel>
    );
  if (query.isLoading) return <PageSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!inv) return null;
  if (need === "any" || inv.status === "completed") return <>{children(inv)}</>;
  if (inv.status === "running" || inv.status === "created")
    return (
      <div className="mx-auto mt-6 max-w-3xl">
        <PipelineProgress inv={inv} />
      </div>
    );
  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-4">
      <ErrorState error={inv.error ?? `Investigation ${inv.status}`} />
      <div className="flex gap-2">
        <Button variant="primary" icon={<RotateCw className="h-4 w-4" />} loading={resume.isPending} onClick={() => resume.mutate()}>
          Resume analysis
        </Button>
        <Button onClick={() => go("/portal")}>Configure new investigation</Button>
      </div>
      <PipelineProgress inv={inv} />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

const STAGE_ICON: Record<StageState["status"], ReactNode> = {
  pending: <Circle className="h-4 w-4 text-ink-3" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-cyan" />,
  done: <CheckCircle2 className="h-4 w-4 text-healthy" />,
  error: <XCircle className="h-4 w-4 text-crit" />,
  skipped: <CircleDashed className="h-4 w-4 text-ink-3" />,
};

export function PipelineProgress({ inv, compact }: { inv: Investigation; compact?: boolean }) {
  const qc = useQueryClient();
  const [showLogs, setShowLogs] = useState(!compact);
  const cancel = useMutation({ mutationFn: () => api.cancel(inv.id), onSuccess: () => void qc.invalidateQueries({ queryKey: qk.investigation(inv.id) }) });
  const motionOff = useMotionOff();
  return (
    <Panel>
      <PanelHeader
        title="Analysis pipeline"
        subtitle={inv.status === "running" ? "Streaming live progress from the backend" : `Status: ${inv.status}`}
        icon={<Radar className="h-4 w-4" />}
        actions={
          inv.status === "running" && (
            <Button size="sm" variant="danger" icon={<Square className="h-3 w-3" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel
            </Button>
          )
        }
      />
      <div className="p-4">
        {inv.isDemo && <SimulatedBanner className="mb-4" />}
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={inv.progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <motion.div className="h-full rounded-full bg-gradient-to-r from-teal to-bio" animate={{ width: `${inv.progress.percent}%` }} transition={{ duration: motionOff ? 0 : 0.4 }} />
        </div>
        <ol className="space-y-2">
          {inv.progress.stages.map((s) => (
            <li key={s.stage} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5", s.status === "running" && "bg-cyan/[0.06]")}>
              {STAGE_ICON[s.status]}
              <span className={cn("text-sm", s.status === "pending" ? "text-ink-3" : "text-ink")}>{s.label}</span>
              {s.detail && <span className={cn("ml-auto truncate pl-2 font-mono text-xs", s.status === "error" ? "text-crit" : "text-ink-2")}>{s.detail}</span>}
            </li>
          ))}
        </ol>
        {inv.progress.logs.length > 0 && (
          <div className="mt-4">
            <button className="flex items-center gap-1 text-xs text-ink-2 hover:text-ink" onClick={() => setShowLogs((v) => !v)} aria-expanded={showLogs}>
              {showLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Analysis log ({inv.progress.logs.length})
            </button>
            {showLogs && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-obsidian/70 p-2 font-mono text-[11px] leading-5">
                {inv.progress.logs.map((l, i) => (
                  <div key={i} className={cn(l.level === "error" ? "text-crit" : l.level === "warn" ? "text-warn" : "text-ink-2")}>
                    <span className="text-ink-3">{new Date(l.at).toLocaleTimeString()}</span> {l.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── Signals & evidence ──────────────────────────────────────────────

export function SignalList({ assessment, max }: { assessment: RiskAssessment; max?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const signals = max ? assessment.signals.slice(0, max) : assessment.signals;
  if (assessment.signals.length === 0) return <p className="text-sm text-ink-3">No risk signals detected for this commit.</p>;
  return (
    <ul className="space-y-1.5">
      {signals.map((s) => (
        <li key={s.id} className="rounded-lg border border-line bg-obsidian/40">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
            {open === s.id ? <ChevronDown className="h-3.5 w-3.5 text-ink-3" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-3" />}
            <span className="flex-1 text-sm text-ink">{s.label}</span>
            <DetectionBadge detection={s.detection} />
            <span className="w-10 text-right font-mono text-xs text-warn">+{s.weight}</span>
          </button>
          {open === s.id && (
            <div className="border-t border-line px-3 py-2">
              <p className="mb-2 text-xs text-ink-2">{s.description}</p>
              <EvidenceList evidence={s.evidence} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EvidenceList({ evidence, onOpen }: { evidence: EvidenceReference[]; onOpen?: (e: EvidenceReference) => void }) {
  if (!evidence.length) return <p className="text-xs text-ink-3">No evidence references.</p>;
  return (
    <ul className="space-y-1">
      {evidence.map((e) => (
        <li key={e.id} id={`ev-${e.id}`} className="rounded-md bg-white/[0.02] px-2 py-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="rounded bg-bio/10 px-1 font-mono text-[10px] text-bio">{e.id}</code>
            {e.filePath && (
              <button className="font-mono text-cyan hover:underline disabled:no-underline" disabled={!onOpen} onClick={() => onOpen?.(e)}>
                {e.filePath}
                {e.line ? `:${e.line}` : ""}
              </button>
            )}
            <span className="text-ink-2">{e.description}</span>
          </div>
          {e.snippet && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-obsidian px-2 py-1 font-mono text-[11px] text-ink">{e.snippet}</pre>}
        </li>
      ))}
    </ul>
  );
}

// ─── Lightweight diff viewer (drawers, previews) ─────────────────────

export function MiniDiff({ patch, maxLines = 400 }: { patch: string | null; maxLines?: number }) {
  if (!patch) return <p className="px-3 py-2 text-xs text-ink-3">No textual diff available (binary, truncated, or unchanged).</p>;
  const lines = patch.split("\n").slice(0, maxLines);
  return (
    <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.55]">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre px-3",
            l.startsWith("@@") && "bg-cyan/[0.06] text-cyan",
            l.startsWith("+") && !l.startsWith("+++") && "bg-healthy/[0.09] text-[#b8f5d3]",
            l.startsWith("-") && !l.startsWith("---") && "bg-crit/[0.09] text-[#ffc2cd]",
            !/^[@+-]/.test(l) && "text-ink-2",
          )}
        >
          {l || " "}
        </div>
      ))}
      {patch.split("\n").length > maxLines && <div className="px-3 py-1 text-ink-3">… diff truncated for display</div>}
    </pre>
  );
}

// ─── Commit details drawer ───────────────────────────────────────────

export function CommitDrawer({ inv, commit, assessment, onClose }: { inv: Investigation; commit: Commit | null; assessment: RiskAssessment | undefined; onClose: () => void }) {
  const { go } = useSelection();
  const qc = useQueryClient();
  const [file, setFile] = useState<string | null>(null);
  const motionOff = useMotionOff();
  const bookmarked = !!commit && inv.bookmarks.some((b) => b.sha === commit.sha);
  const toggleBookmark = useMutation({
    mutationFn: () =>
      api.updateInvestigation(inv.id, {
        bookmarks: bookmarked ? inv.bookmarks.filter((b) => b.sha !== commit!.sha) : [...inv.bookmarks, { sha: commit!.sha, label: firstLine(commit!.message).slice(0, 80), createdAt: new Date().toISOString() }],
      }),
    onSuccess: (next) => {
      qc.setQueryData(qk.investigation(inv.id), next);
      toast.success(bookmarked ? "Bookmark removed" : "Commit bookmarked");
    },
  });
  const finding = commit ? inv.findings.find((f) => f.commitSha === commit.sha) : undefined;
  const parent = commit?.parents[0] ?? null;
  const fileObj = useMemo(() => commit?.files.find((f) => f.path === file) ?? null, [commit, file]);

  return (
    <AnimatePresence>
      {commit && (
        <motion.aside
          key={commit.sha}
          initial={motionOff ? false : { x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={motionOff ? undefined : { x: 40, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-xl"
          aria-label="Commit details"
        >
          <div className="flex items-start gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-teal">Mutation · commit</span>
                <Sha sha={commit.sha} />
                {assessment && <ScoreBadge score={assessment.score} />}
                {finding && <Badge tone={finding.rank === 1 ? "crit" : "warn"}>Suspect #{finding.rank}</Badge>}
                {inv.knownGoodSha && commit.sha.startsWith(inv.knownGoodSha) && <Badge tone="healthy">Known good</Badge>}
                {inv.knownBadSha && commit.sha.startsWith(inv.knownBadSha) && <Badge tone="crit">Known bad</Badge>}
              </div>
              <h3 className="font-display text-base font-semibold leading-snug text-ink">{firstLine(commit.message)}</h3>
              <p className="mt-1 text-xs text-ink-2">
                {commit.author.name} · {fmtDate(commit.date)}
                {commit.url && (
                  <>
                    {" · "}
                    <a href={commit.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                      GitHub
                    </a>
                  </>
                )}
              </p>
            </div>
            <Button size="icon" variant="ghost" aria-label="Close details" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
            <Button size="sm" variant="outline" icon={<GitCompare className="h-3.5 w-3.5" />} disabled={!parent} onClick={() => go("/divergence", { a: parent, b: commit.sha, commit: commit.sha })}>
              View diff
            </Button>
            <Button size="sm" variant="outline" icon={<Brain className="h-3.5 w-3.5" />} onClick={() => go("/gemma", { commit: commit.sha })}>
              Analyze with Gemma
            </Button>
            <Button size="sm" variant="outline" icon={<Network className="h-3.5 w-3.5" />} onClick={() => go("/infection", { commit: commit.sha })}>
              View impact
            </Button>
            <Button size="sm" variant="ghost" icon={bookmarked ? <BookmarkCheck className="h-3.5 w-3.5 text-bio" /> : <Bookmark className="h-3.5 w-3.5" />} loading={toggleBookmark.isPending} onClick={() => toggleBookmark.mutate()}>
              {bookmarked ? "Bookmarked" : "Bookmark"}
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {commit.message.includes("\n") && <p className="whitespace-pre-wrap rounded-lg bg-obsidian/50 p-2 text-xs text-ink-2">{commit.message.split("\n").slice(1).join("\n").trim()}</p>}
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Files" value={commit.files.length} />
              <MiniStat label="Additions" value={`+${commit.stats?.additions ?? commit.files.reduce((s, f) => s + f.additions, 0)}`} color="text-healthy" />
              <MiniStat label="Deletions" value={`−${commit.stats?.deletions ?? commit.files.reduce((s, f) => s + f.deletions, 0)}`} color="text-crit" />
            </div>
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">Changed files</h4>
              <ul className="space-y-1">
                {commit.files.map((f) => (
                  <li key={f.path}>
                    <button onClick={() => setFile(file === f.path ? null : f.path)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/[0.03]", file === f.path && "bg-cyan/[0.06]")}>
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.path}</span>
                      <Badge tone={f.status === "added" ? "healthy" : f.status === "removed" ? "crit" : f.status === "renamed" ? "cyan" : "neutral"}>{f.status}</Badge>
                      <span className="font-mono text-healthy">+{f.additions}</span>
                      <span className="font-mono text-crit">−{f.deletions}</span>
                    </button>
                    {file === f.path && fileObj && (
                      <div className="mt-1 max-h-80 overflow-auto rounded-md border border-line bg-obsidian/70">
                        <MiniDiff patch={fileObj.patch} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            {assessment && (
              <section>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">
                  Risk factors <span className="font-normal normal-case tracking-normal text-ink-3">(heuristic score, not a probability)</span>
                </h4>
                <SignalList assessment={assessment} />
                {assessment.modifiedFunctions.length > 0 && (
                  <div className="mt-3">
                    <h5 className="mb-1 text-xs text-ink-2">Modified functions (AST)</h5>
                    <div className="flex flex-wrap gap-1">
                      {assessment.modifiedFunctions.map((f) => (
                        <Badge key={f.id} tone="cyan" title={`${f.filePath}:${f.startLine}-${f.endLine}`}>
                          {f.name}
                          {f.exported && <span className="opacity-60">·exp</span>}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {assessment.skippedFiles.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
                    <AlertTriangle className="mt-0.5 h-3 w-3" /> {assessment.skippedFiles.length} file(s) skipped: {assessment.skippedFiles.map((s) => `${s.path} (${s.reason})`).join(", ")}
                  </p>
                )}
              </section>
            )}
            {finding && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">Related findings</h4>
                <p className="text-sm text-ink">
                  Ranked <strong>#{finding.rank}</strong> Patient Zero candidate — {finding.status.replace(/-/g, " ")}.
                </p>
              </section>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function MiniStat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="rounded-lg border border-line bg-obsidian/40 px-2 py-2">
      <div className={cn("font-mono text-sm font-semibold", color ?? "text-ink")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
    </div>
  );
}

export function CommitLabel({ commit }: { commit: Pick<Commit, "sha" | "message"> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Sha sha={commit.sha} />
      <span className="truncate">{firstLine(commit.message)}</span>
    </span>
  );
}

export { SIGNAL_LABELS, short };
