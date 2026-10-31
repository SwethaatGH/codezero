import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Bot, Brain, Copy, FileSearch, FlaskConical, GitBranchPlus, Lightbulb, Loader2, Network, RefreshCw, Send, ShieldQuestion, Sparkles, Square, TestTube2, User } from "lucide-react";
import { toast } from "sonner";
import type { AIAnalysis, AITask, ExplanationLevel, Investigation } from "@code-zero/shared";
import { api, streamChat } from "../lib/api";
import { qk, useAIAnalyses, useAIStatus, useTimeline } from "../lib/queries";
import { useUI } from "../lib/store";
import { cn, firstLine, relTime, short } from "../lib/utils";
import { Badge, Button, CopyButton, EmptyState, ErrorState, PageTitle, Panel, PanelHeader, Select, Sha, SimulatedBanner, StatusDot, Tabs, Textarea } from "../components/ui";
import { InvestigationGate, useActiveInvestigation } from "../components/investigation";

const TASKS: { id: AITask; label: string; icon: typeof Brain; hint: string }[] = [
  { id: "root-cause", label: "Root cause analysis", icon: Brain, hint: "Likely failure mechanism" },
  { id: "commit-investigation", label: "Why was this flagged?", icon: FileSearch, hint: "Walk through each risk signal" },
  { id: "semantic-diff", label: "Semantic diff", icon: GitBranchPlus, hint: "Behavioral changes vs parent" },
  { id: "impact", label: "Impact explanation", icon: Network, hint: "Downstream effects" },
  { id: "tests", label: "Test generation", icon: TestTube2, hint: "Regression tests" },
  { id: "fix", label: "Fix recommendations", icon: FlaskConical, hint: "Candidate changes" },
  { id: "alternatives", label: "Alternative hypotheses", icon: ShieldQuestion, hint: "Competing explanations" },
];

const SUGGESTED = [
  "Why might this commit cause the reported symptoms?",
  "Which edge cases could fail after this change?",
  "What test would prove or disprove the hypothesis?",
  "Could a different commit explain this instead?",
  "Explain the blast radius in plain language.",
];

export default function Gemma() {
  return (
    <>
      <PageTitle themed="Gemma Intelligence" technical="AI investigation engine · Gemma 4" description="Gemma receives bounded, evidence-indexed context: repository metadata, the selected commit's diff, risk signals, modified functions, dependents and test results." />
      <InvestigationGate>{(inv) => <GemmaView inv={inv} />}</InvestigationGate>
    </>
  );
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  error?: string;
}

function GemmaView({ inv }: { inv: Investigation }) {
  const { commitSha, selectCommit } = useActiveInvestigation();
  const tl = useTimeline(inv);
  const ai = useAIAnalyses(inv.id);
  const status = useAIStatus();
  const qc = useQueryClient();
  const { level, setLevel } = useUI();
  const target = commitSha ?? inv.selectedCommitSha ?? inv.findings[0]?.commitSha ?? null;
  const commit = tl.data?.commits.find((c) => target && c.sha.startsWith(target));
  const assessment = tl.data?.assessments.find((a) => a.commitSha === commit?.sha);
  const [view, setView] = useState<"analyses" | "chat">("analyses");

  const run = useMutation({
    mutationFn: (task: AITask) => api.aiAnalyze({ investigationId: inv.id, task, commitSha: commit?.sha ?? null, level }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: qk.ai(inv.id) });
      toast.success("Analysis complete", { description: a.source === "live" ? `Live inference · ${a.model}` : "Prerecorded demo analysis (Gemma unavailable)" });
    },
    onError: (e) => toast.error("Gemma analysis failed", { description: (e as Error).message }),
  });

  const forCommit = (ai.data ?? []).filter((a) => !commit || a.commitSha === commit.sha);
  const state = run.isPending ? "generating" : status.isLoading ? "loading" : status.data?.state === "connected" ? "connected" : status.data?.state === "model-missing" || status.data?.state === "unavailable" ? "unavailable" : "error";
  const stateLabel = { generating: "Generating", loading: "Loading", connected: "Connected", unavailable: "Unavailable", error: "Error" }[state];

  return (
    <div className="space-y-4">
      {inv.isDemo && <SimulatedBanner />}
      {status.data && status.data.state !== "connected" && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div>
            <strong className="text-warn">Gemma {stateLabel.toLowerCase()}.</strong> <span className="text-ink-2">{status.data.message}</span>
            {inv.isDemo && <div className="text-xs text-ink-2">Structured analyses for the demo fall back to clearly labeled <strong>prerecorded</strong> content. Live chat requires a working model.</div>}
          </div>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Context" subtitle="What Gemma will see" icon={<Sparkles className="h-4 w-4" />} actions={<span className="flex items-center gap-1.5 text-xs text-ink-2"><StatusDot tone={state === "connected" ? "healthy" : state === "generating" || state === "loading" ? "cyan" : "warn"} pulse={state === "generating"} />{stateLabel}</span>} />
            <div className="space-y-3 p-4 text-sm">
              <label className="block text-xs text-ink-2">
                Selected commit
                <Select className="mt-1 font-mono text-xs" value={commit?.sha ?? ""} onChange={(e) => selectCommit(e.target.value)}>
                  {(tl.data?.commits ?? []).map((c) => (
                    <option key={c.sha} value={c.sha}>{c.shortSha} · {firstLine(c.message).slice(0, 40)}</option>
                  ))}
                </Select>
              </label>
              <ul className="space-y-1 text-xs text-ink-2">
                <li>Repository: <span className="text-ink">{inv.repoFullName}</span></li>
                <li>Diff: <span className="text-ink">{commit?.files.length ?? 0} file(s)</span> (bounded to ~14k chars)</li>
                <li>Risk signals: <span className="text-ink">{assessment?.signals.length ?? 0}</span> · evidence refs: <span className="text-ink">{assessment?.signals.reduce((s, x) => s + Math.min(6, x.evidence.length), 0) ?? 0}</span></li>
                <li>Modified functions: <span className="text-ink">{assessment?.modifiedFunctions.length ?? 0}</span></li>
                <li>Symptoms: <span className="text-ink">{inv.params.symptoms ? "provided" : "none"}</span></li>
                <li>Test results: <span className="text-ink">{tl.data?.bisect ? "demo harness" : "none (never fabricated)"}</span></li>
              </ul>
              <label className="block text-xs text-ink-2">
                Explanation level
                <Select className="mt-1" value={level} onChange={(e) => setLevel(e.target.value as ExplanationLevel)}>
                  <option value="beginner">Beginner</option>
                  <option value="developer">Developer</option>
                  <option value="expert">Expert</option>
                </Select>
              </label>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="AI capabilities" subtitle="Structured, Zod-validated output" icon={<Brain className="h-4 w-4" />} />
            <div className="grid gap-1.5 p-3">
              {TASKS.map((t) => (
                <button key={t.id} disabled={run.isPending || !commit} onClick={() => { setView("analyses"); run.mutate(t.id); }} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-left hover:border-cyan/40 hover:bg-cyan/[0.04] disabled:opacity-50">
                  {run.isPending && run.variables === t.id ? <Loader2 className="h-4 w-4 animate-spin text-cyan" /> : <t.icon className="h-4 w-4 text-bio" />}
                  <div>
                    <div className="text-sm text-ink">{t.label}</div>
                    <div className="text-[11px] text-ink-3">{t.hint}</div>
                  </div>
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-3">
          <Tabs value={view} onChange={setView} tabs={[{ id: "analyses", label: "Structured analyses", count: forCommit.length }, { id: "chat", label: "Assistant chat" }]} />
          {view === "analyses" ? (
            <div className="space-y-3">
              {run.isPending && (
                <Panel className="flex items-center gap-3 p-4 text-sm text-ink-2">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan" /> Gemma is analyzing {short(commit?.sha)}… structured output is validated before display.
                </Panel>
              )}
              {run.isError && <ErrorState error={run.error} onRetry={() => run.mutate(run.variables!)} />}
              {forCommit.length === 0 && !run.isPending && <Panel><EmptyState icon={<Brain className="h-5 w-5" />} title="No analyses for this commit yet" description="Pick a capability on the left. Results are saved to the investigation and included in reports." /></Panel>}
              {forCommit.map((a) => (
                <AnalysisCard key={a.id} analysis={a} />
              ))}
            </div>
          ) : (
            <Chat inv={inv} commitSha={commit?.sha ?? null} level={level} connected={status.data?.state === "connected"} />
          )}
        </div>
      </div>
    </div>
  );
}

function Chat({ inv, commitSha, level, connected }: { inv: Investigation; commitSha: string | null; level: ExplanationLevel; connected: boolean }) {
  const storageKey = `cz-chat-${inv.id}`;
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as Msg[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [meta, setMeta] = useState<{ model: string; contextChars: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(messages));
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, storageKey]);

  const send = async (history: Msg[]) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStreaming(true);
    setMessages([...history, { role: "assistant", content: "" }]);
    try {
      await streamChat(
        { investigationId: inv.id, commitSha, level, messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) },
        (ev) => {
          if (ev.type === "meta") setMeta({ model: ev.model, contextChars: ev.contextChars });
          if (ev.type === "token") setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, content: m.content + ev.text } : m)));
          if (ev.type === "error") setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, error: ev.message } : m)));
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, error: (e as Error).message } : m)));
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  };

  const submit = (text: string) => {
    if (!text.trim() || streaming) return;
    setInput("");
    void send([...messages, { role: "user", content: text.trim() }]);
  };
  const retry = () => {
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUser >= 0) void send(messages.slice(0, lastUser + 1));
  };

  return (
    <Panel className="flex h-[640px] flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-ink-2">
        <Bot className="h-4 w-4 text-bio" />
        <span>Context: <span className="text-ink">{inv.repoFullName}</span> · commit <Sha sha={commitSha} /></span>
        {meta && <span className="ml-auto">{meta.model} · {meta.contextChars.toLocaleString()} context chars</span>}
        {messages.length > 0 && <Button size="sm" variant="ghost" className={meta ? "" : "ml-auto"} onClick={() => setMessages([])} disabled={streaming}>Clear</Button>}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <Lightbulb className="mx-auto h-6 w-6 text-bio" />
            <p className="mt-2 text-sm text-ink-2">Ask about the selected commit. Gemma cites evidence IDs and separates observation from speculation.</p>
            {!connected && <p className="mt-2 text-xs text-warn">Live chat is unavailable until Gemma is connected (see Settings).</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTED.map((s) => (
                <button key={s} onClick={() => submit(s)} className="rounded-full border border-line-2 px-3 py-1.5 text-xs text-ink-2 hover:border-cyan/50 hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-cyan/15 text-cyan" : "bg-bio/15 text-bio")}>{m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}</div>
            <div className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm", m.role === "user" ? "bg-cyan/[0.08] text-ink" : "border border-line bg-obsidian/50")}>
              {m.role === "assistant" ? (
                <>
                  {m.content ? <div className="prose-lab"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div> : !m.error && <Loader2 className="h-4 w-4 animate-spin text-cyan" />}
                  {m.error && <div className="mt-1 flex items-start gap-1.5 text-xs text-crit"><AlertTriangle className="mt-0.5 h-3.5 w-3.5" />{m.error}</div>}
                  {!streaming && (m.content || m.error) && (
                    <div className="mt-2 flex gap-1 border-t border-line pt-1.5">
                      {m.content && <CopyButton text={m.content} />}
                      {i === messages.length - 1 && <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={retry}>Retry</Button>}
                    </div>
                  )}
                </>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); submit(input); }}>
        <Textarea
          aria-label="Message Gemma"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }}
          placeholder="Ask Gemma about this investigation… (Enter to send, Shift+Enter for newline)"
          className="resize-none"
        />
        {streaming ? (
          <Button type="button" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={() => abort.current?.abort()}>Stop</Button>
        ) : (
          <Button type="submit" variant="primary" icon={<Send className="h-3.5 w-3.5" />} disabled={!input.trim()}>Send</Button>
        )}
      </form>
    </Panel>
  );
}

const TASK_LABEL: Record<AITask, string> = Object.fromEntries(TASKS.map((t) => [t.id, t.label])) as Record<AITask, string>;

export function AnalysisCard({ analysis: a, compact }: { analysis: AIAnalysis; compact?: boolean }) {
  const [openEv, setOpenEv] = useState<string | null>(null);
  const evById = useMemo(() => new Map(a.evidence.map((e) => [e.id, e])), [a.evidence]);
  const chips = (ids: string[]) =>
    ids.length > 0 && (
      <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
        {ids.map((id) => (
          <button key={id} onClick={() => setOpenEv(openEv === id ? null : id)} className="rounded bg-bio/10 px-1 font-mono text-[10px] text-bio hover:bg-bio/20" title={evById.get(id)?.description}>
            {id}
          </button>
        ))}
      </span>
    );
  const ev = openEv ? evById.get(openEv) : null;
  return (
    <Panel className={cn("overflow-hidden", compact && "border-line bg-obsidian/40")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Brain className="h-4 w-4 text-bio" />
        <span className="font-display text-sm font-semibold">{TASK_LABEL[a.task] ?? a.task}</span>
        {a.commitSha && <Sha sha={a.commitSha} />}
        {a.source === "live" ? <Badge tone="bio">LIVE · {a.model}</Badge> : <Badge tone="warn" title="Gemma was unavailable; this is prerecorded demo content, not live inference">PRERECORDED DEMO</Badge>}
        <Badge tone="neutral">{a.level}</Badge>
        <span className="ml-auto text-xs text-ink-3">{relTime(a.createdAt)}</span>
      </div>
      <div className="space-y-4 p-4 text-sm">
        <p className="text-ink">{a.summary}</p>
        {a.observations.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan">Observations — directly supported by evidence</h4>
            <ul className="space-y-1 text-ink-2">
              {a.observations.map((o, i) => (
                <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-cyan" /><span>{o.text}{chips(o.evidenceIds)}</span></li>
              ))}
            </ul>
          </section>
        )}
        {a.hypotheses.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-warn">Hypotheses — interpretation, not verified</h4>
            <ul className="space-y-2">
              {a.hypotheses.map((h, i) => (
                <li key={i} className="rounded-lg border border-line bg-obsidian/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{h.title}</span>
                    <Badge tone={h.confidence === "high" ? "crit" : h.confidence === "medium" ? "warn" : "neutral"}>{h.confidence} confidence</Badge>
                  </div>
                  <p className="mt-1 text-ink-2">{h.explanation}{chips(h.evidenceIds)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {ev && (
          <div className="rounded-lg border border-bio/30 bg-bio/[0.05] p-2.5 text-xs">
            <div className="font-mono text-bio">{ev.id} · {ev.filePath}{ev.line ? `:${ev.line}` : ""}</div>
            <div className="text-ink-2">{ev.description}</div>
            {ev.snippet && <pre className="mt-1 whitespace-pre-wrap font-mono text-ink">{ev.snippet}</pre>}
          </div>
        )}
        {!compact && a.riskExplanation && (
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Risk explanation</h4>
            <p className="text-ink-2">{a.riskExplanation}</p>
          </section>
        )}
        {!compact && a.suggestedTests.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Suggested tests</h4>
            {a.suggestedTests.map((t, i) => (
              <div key={i} className="mb-2 rounded-lg border border-line">
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <TestTube2 className="h-3.5 w-3.5 text-bio" />
                  <span className="text-ink">{t.name}</span>
                  {t.targetFile && <code className="font-mono text-[11px] text-ink-3">{t.targetFile}</code>}
                  {t.code && <span className="ml-auto"><CopyButton text={t.code} /></span>}
                </div>
                <p className="px-3 pb-1.5 text-xs text-ink-2">{t.description}</p>
                {t.code && <pre className="max-h-64 overflow-auto border-t border-line bg-obsidian/70 p-3 font-mono text-[11.5px] text-ink">{t.code}</pre>}
              </div>
            ))}
          </section>
        )}
        {!compact && a.recommendedActions.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Recommended actions</h4>
            <ol className="list-decimal space-y-0.5 pl-5 text-ink-2">{a.recommendedActions.map((r, i) => <li key={i}>{r}</li>)}</ol>
          </section>
        )}
        {a.uncertaintyNotes.length > 0 && (
          <section className="rounded-lg border border-line-2 bg-white/[0.02] p-2.5">
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Uncertainty</h4>
            <ul className="space-y-0.5 text-xs text-ink-2">{a.uncertaintyNotes.map((u, i) => <li key={i}>• {u}</li>)}</ul>
          </section>
        )}
        {a.unknownEvidenceIds.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warn">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> Gemma cited {a.unknownEvidenceIds.length} evidence ID(s) that were not in its context ({a.unknownEvidenceIds.join(", ")}); those citations were removed.
          </p>
        )}
        {compact && <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard.writeText(a.summary)}>Copy summary</Button>}
      </div>
    </Panel>
  );
}
