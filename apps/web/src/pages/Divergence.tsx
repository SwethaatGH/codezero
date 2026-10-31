import "../lib/monaco";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { ArrowLeftRight, ArrowDown, ArrowUp, Brain, Columns2, FileCode2, FolderTree, GitCompare, Network, Package, Rows2, RotateCcw, Settings2, SquareFunction } from "lucide-react";
import { toast } from "sonner";
import type { ChangedFile, Commit, Investigation } from "@code-zero/shared";
import { api } from "../lib/api";
import { qk, useAIAnalyses, useTimeline } from "../lib/queries";
import { useUI } from "../lib/store";
import { cn, firstLine, languageForPath, short } from "../lib/utils";
import { Badge, Button, EmptyState, ErrorState, PageTitle, Panel, PanelHeader, Select, SimulatedBanner, Skeleton, Tabs } from "../components/ui";
import { InvestigationGate, MiniDiff, useActiveInvestigation } from "../components/investigation";
import { AnalysisCard } from "./Gemma";

type Tab = "code" | "functions" | "tree" | "deps" | "config" | "ai";

export default function Divergence() {
  return (
    <>
      <PageTitle themed="Timeline Divergence" technical="DNA comparison · code diff" description="Compare a known working version (left) with a suspected broken version (right)." />
      <InvestigationGate>{(inv) => <DivergenceView inv={inv} />}</InvestigationGate>
    </>
  );
}

function DivergenceView({ inv }: { inv: Investigation }) {
  const { compareA, compareB, setCompare, go, selectCommit } = useActiveInvestigation();
  const tl = useTimeline(inv);
  const chrono = useMemo(() => [...(tl.data?.commits ?? [])].reverse(), [tl.data]);

  // Defaults: parent of top suspect → top suspect.
  const top = inv.findings[0]?.commitSha;
  const topCommit = chrono.find((c) => c.sha === top);
  const a = compareA ?? inv.knownGoodSha ?? topCommit?.parents[0] ?? chrono[0]?.sha ?? null;
  const b = compareB ?? top ?? chrono[chrono.length - 1]?.sha ?? null;

  const [tab, setTab] = useState<Tab>("code");
  const cmp = useQuery({ queryKey: ["compare", inv.id, a, b], queryFn: () => api.compare(inv.id, a!, b!), enabled: !!a && !!b && a !== b, staleTime: Infinity });

  const options = useMemo(() => {
    const list: { sha: string; label: string }[] = chrono.map((c) => ({ sha: c.sha, label: `${c.shortSha} · ${firstLine(c.message).slice(0, 56)}` }));
    const oldestParent = chrono[0]?.parents[0];
    if (oldestParent) list.unshift({ sha: oldestParent, label: `${short(oldestParent)} · (parent of range)` });
    for (const s of [a, b]) if (s && !list.some((o) => o.sha.startsWith(s))) list.unshift({ sha: s, label: `${short(s)} · (outside analyzed range)` });
    return list;
  }, [chrono, a, b]);

  if (tl.isLoading) return <Skeleton className="h-[600px]" />;
  const bInRange = !!b && chrono.some((c) => c.sha.startsWith(b));

  return (
    <div className="space-y-3">
      {inv.isDemo && <SimulatedBanner />}
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-healthy/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-healthy">A · working</span>
          <Select aria-label="Commit A (known working)" value={options.find((o) => a && o.sha.startsWith(a))?.sha ?? ""} onChange={(e) => setCompare(e.target.value, b)} className="w-72 font-mono text-xs">
            {options.map((o) => <option key={o.sha} value={o.sha}>{o.label}</option>)}
          </Select>
        </div>
        <Button size="icon" variant="ghost" aria-label="Swap commits" onClick={() => setCompare(b, a)}><ArrowLeftRight className="h-4 w-4" /></Button>
        <div className="flex items-center gap-2">
          <span className="rounded bg-crit/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-crit">B · suspect</span>
          <Select aria-label="Commit B (suspected broken)" value={options.find((o) => b && o.sha.startsWith(b))?.sha ?? ""} onChange={(e) => setCompare(a, e.target.value)} className="w-72 font-mono text-xs">
            {options.map((o) => <option key={o.sha} value={o.sha}>{o.label}</option>)}
          </Select>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setCompare(null, null)}>Reset</Button>
          <Button size="sm" variant="ghost" icon={<GitCompare className="h-3.5 w-3.5" />} disabled={!b} onClick={() => { selectCommit(b); go("/timeline", { commit: b }); }}>Commit details</Button>
          <Button size="sm" variant="ghost" icon={<Network className="h-3.5 w-3.5" />} disabled={!bInRange} onClick={() => go("/infection", { commit: b })}>Infection Map</Button>
        </div>
      </Panel>

      {a === b ? (
        <Panel><EmptyState title="Select two different commits" description="Commit A and commit B are the same." /></Panel>
      ) : cmp.isError ? (
        <ErrorState error={cmp.error} onRetry={() => cmp.refetch()} />
      ) : !cmp.data ? (
        <Skeleton className="h-[560px]" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "code", label: <><FileCode2 className="h-3.5 w-3.5" />Code diff</>, count: cmp.data.files.length },
                { id: "functions", label: <><SquareFunction className="h-3.5 w-3.5" />Function diff</>, count: cmp.data.functionChanges.length },
                { id: "tree", label: <><FolderTree className="h-3.5 w-3.5" />File tree</> },
                { id: "deps", label: <><Package className="h-3.5 w-3.5" />Dependencies</>, count: cmp.data.dependencyChanges.reduce((s, d) => s + d.added.length + d.removed.length + d.changed.length, 0) },
                { id: "config", label: <><Settings2 className="h-3.5 w-3.5" />Configuration</>, count: cmp.data.configChanges.length },
                { id: "ai", label: <><Brain className="h-3.5 w-3.5" />AI semantic diff</> },
              ]}
            />
            <span className="ml-auto font-mono text-xs text-ink-2">
              {cmp.data.totals.files} files · <span className="text-healthy">+{cmp.data.totals.additions}</span> <span className="text-crit">−{cmp.data.totals.deletions}</span> · {cmp.data.commits.length} commit(s) between
            </span>
          </div>
          {tab === "code" && <CodeDiff inv={inv} a={a!} b={b!} files={cmp.data.files} />}
          {tab === "functions" && (
            <Panel>
              {cmp.data.functionChanges.length === 0 ? (
                <EmptyState title="No function-level changes detected" description="Function diff uses the TypeScript AST and covers JS/TS files only." />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-ink-2"><tr><th className="px-4 py-2">Function</th><th>File</th><th className="px-4">Change</th></tr></thead>
                  <tbody>
                    {cmp.data.functionChanges.map((f) => (
                      <tr key={`${f.filePath}#${f.name}`} className="border-t border-line">
                        <td className="px-4 py-2 font-mono text-ink">{f.name}</td>
                        <td className="font-mono text-xs text-ink-2">{f.filePath}</td>
                        <td className="px-4"><Badge tone={f.change === "added" ? "healthy" : f.change === "removed" ? "crit" : "warn"}>{f.change}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}
          {tab === "tree" && <FileTree files={cmp.data.files} />}
          {tab === "deps" && (
            <Panel className="p-4">
              {cmp.data.dependencyChanges.length === 0 ? (
                <EmptyState icon={<Package className="h-5 w-5" />} title="No package.json dependency changes" description="Other manifest types (lockfiles, requirements.txt…) appear in the code diff." />
              ) : (
                cmp.data.dependencyChanges.map((d) => (
                  <div key={d.path} className="space-y-1.5">
                    <div className="font-mono text-sm text-ink">{d.path}</div>
                    {d.added.map((x) => <div key={x} className="font-mono text-xs text-healthy">+ {x}</div>)}
                    {d.removed.map((x) => <div key={x} className="font-mono text-xs text-crit">− {x}</div>)}
                    {d.changed.map((x) => <div key={x} className="font-mono text-xs text-warn">~ {x}</div>)}
                    {d.added.length + d.removed.length + d.changed.length === 0 && <div className="text-xs text-ink-3">Manifest changed, but dependency versions are identical.</div>}
                  </div>
                ))
              )}
            </Panel>
          )}
          {tab === "config" && (
            <Panel>
              {cmp.data.configChanges.length === 0 ? (
                <EmptyState icon={<Settings2 className="h-5 w-5" />} title="No configuration files changed" />
              ) : (
                <div className="divide-y divide-line">
                  {cmp.data.files.filter((f) => cmp.data!.configChanges.includes(f.path)).map((f) => (
                    <div key={f.path}>
                      <div className="px-4 py-2 font-mono text-sm text-ink">{f.path}</div>
                      <div className="max-h-72 overflow-auto bg-obsidian/60"><MiniDiff patch={f.patch} /></div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}
          {tab === "ai" && <SemanticDiff inv={inv} a={a!} b={b!} inRange={bInRange} />}
        </>
      )}
    </div>
  );
}

function CodeDiff({ inv, a, b, files }: { inv: Investigation; a: string; b: string; files: ChangedFile[] }) {
  const [path, setPath] = useState(files.find((f) => !f.binary)?.path ?? null);
  const [inline, setInline] = useState(false);
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const [changes, setChanges] = useState(0);
  const idx = useRef(-1);
  useEffect(() => setPath(files.find((f) => !f.binary)?.path ?? null), [files]);
  const file = files.find((f) => f.path === path);
  const left = useQuery({ queryKey: ["file", inv.id, file?.previousPath ?? path, a], queryFn: () => api.file(inv.id, file?.previousPath ?? path!, a), enabled: !!path && file?.status !== "added", staleTime: Infinity });
  const right = useQuery({ queryKey: ["file", inv.id, path, b], queryFn: () => api.file(inv.id, path!, b), enabled: !!path && file?.status !== "removed", staleTime: Infinity });

  const nav = (dir: 1 | -1) => {
    const ed = editorRef.current;
    const lc = ed?.getLineChanges() ?? [];
    if (!lc.length) return;
    idx.current = (idx.current + dir + lc.length) % lc.length;
    const line = lc[idx.current].modifiedStartLineNumber || lc[idx.current].originalStartLineNumber;
    ed!.getModifiedEditor().revealLineInCenter(line);
    ed!.getModifiedEditor().setPosition({ lineNumber: line, column: 1 });
  };

  const loading = (file?.status !== "added" && left.isLoading) || (file?.status !== "removed" && right.isLoading);
  return (
    <div className="grid h-[620px] gap-3 lg:grid-cols-[280px_1fr]">
      <Panel className="flex min-h-0 flex-col">
        <PanelHeader title="Changed files" subtitle={`${files.length} files`} />
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {files.map((f) => (
            <li key={f.path}>
              <button onClick={() => { setPath(f.path); idx.current = -1; }} disabled={f.binary} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/[0.03] disabled:opacity-40", path === f.path && "bg-cyan/[0.08]")}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", f.status === "added" ? "bg-healthy" : f.status === "removed" ? "bg-crit" : f.status === "renamed" ? "bg-cyan" : "bg-warn")} />
                <span className="min-w-0 flex-1 truncate font-mono text-ink" title={f.path}>{f.path}</span>
                <span className="font-mono text-healthy">+{f.additions}</span>
                <span className="font-mono text-crit">−{f.deletions}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 truncate font-mono text-xs text-ink">{path ?? "—"}</span>
          {file && <Badge tone="neutral">{file.status}</Badge>}
          <span className="text-xs text-ink-3">{changes} change block(s)</span>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => nav(-1)} aria-label="Previous change">Prev</Button>
            <Button size="sm" variant="ghost" icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => nav(1)} aria-label="Next change">Next</Button>
            <Button size="sm" variant={inline ? "ghost" : "secondary"} icon={<Columns2 className="h-3.5 w-3.5" />} onClick={() => setInline(false)}>Side by side</Button>
            <Button size="sm" variant={inline ? "secondary" : "ghost"} icon={<Rows2 className="h-3.5 w-3.5" />} onClick={() => setInline(true)}>Inline</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 border-b border-line text-[10px] font-mono uppercase tracking-wider">
          <div className="px-3 py-1 text-healthy">A · {short(a)} · known working</div>
          <div className="px-3 py-1 text-crit">B · {short(b)} · suspected broken</div>
        </div>
        <div className="min-h-0 flex-1">
          {!path ? (
            <EmptyState title="No textual files to compare" />
          ) : loading ? (
            <Skeleton className="m-3 h-[90%]" />
          ) : left.isError || right.isError ? (
            <ErrorState className="m-3" error={left.error ?? right.error} />
          ) : (
            <DiffEditor
              theme="codezero"
              language={languageForPath(path)}
              original={left.data?.content ?? ""}
              modified={right.data?.content ?? ""}
              onMount={(ed) => {
                editorRef.current = ed;
                ed.onDidUpdateDiff(() => setChanges(ed.getLineChanges()?.length ?? 0));
              }}
              options={{ readOnly: true, renderSideBySide: !inline, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace", fontSize: 12.5, scrollBeyondLastLine: false, renderOverviewRuler: true, originalEditable: false, automaticLayout: true }}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

interface TreeNode { name: string; path: string; children: Map<string, TreeNode>; file?: ChangedFile }
function FileTree({ files }: { files: ChangedFile[] }) {
  const root = useMemo(() => {
    const r: TreeNode = { name: "", path: "", children: new Map() };
    for (const f of files) {
      let cur = r;
      const parts = f.path.split("/");
      parts.forEach((p, i) => {
        if (!cur.children.has(p)) cur.children.set(p, { name: p, path: parts.slice(0, i + 1).join("/"), children: new Map() });
        cur = cur.children.get(p)!;
      });
      cur.file = f;
    }
    return r;
  }, [files]);
  const render = (n: TreeNode, depth: number): React.ReactNode =>
    [...n.children.values()].sort((x, y) => Number(!!x.file) - Number(!!y.file) || x.name.localeCompare(y.name)).map((c) => (
      <div key={c.path}>
        <div className="flex items-center gap-2 py-0.5 font-mono text-xs" style={{ paddingLeft: depth * 16 }}>
          {c.file ? (
            <>
              <Badge tone={c.file.status === "added" ? "healthy" : c.file.status === "removed" ? "crit" : c.file.status === "renamed" ? "cyan" : "warn"}>{c.file.status[0].toUpperCase()}</Badge>
              <span className="text-ink">{c.name}</span>
              {c.file.previousPath && <span className="text-ink-3">← {c.file.previousPath}</span>}
              <span className="text-healthy">+{c.file.additions}</span>
              <span className="text-crit">−{c.file.deletions}</span>
            </>
          ) : (
            <span className="text-ink-2">{c.name}/</span>
          )}
        </div>
        {render(c, depth + 1)}
      </div>
    ));
  return (
    <Panel className="p-4">
      <div className="mb-3 flex gap-3 text-xs text-ink-2">
        {(["added", "modified", "renamed", "removed"] as const).map((s) => (
          <span key={s}>{s}: <strong className="text-ink">{files.filter((f) => f.status === s).length}</strong></span>
        ))}
      </div>
      {render(root, 0)}
    </Panel>
  );
}

function SemanticDiff({ inv, a, b, inRange }: { inv: Investigation; a: string; b: string; inRange: boolean }) {
  const ai = useAIAnalyses(inv.id);
  const qc = useQueryClient();
  const level = useUI((s) => s.level);
  const existing = (ai.data ?? []).find((x) => x.task === "semantic-diff" && x.commitSha?.startsWith(b));
  const run = useMutation({
    mutationFn: () => api.aiAnalyze({ investigationId: inv.id, task: "semantic-diff", commitSha: b, compareBase: a, level }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.ai(inv.id) }),
    onError: (e) => toast.error("Semantic diff failed", { description: (e as Error).message }),
  });
  return (
    <Panel>
      <PanelHeader
        title="AI semantic diff"
        subtitle="Gemma explains what changed, why it matters, which behavior differs, edge cases and tests"
        icon={<Brain className="h-4 w-4" />}
        actions={<Button size="sm" variant="primary" icon={<Brain className="h-3.5 w-3.5" />} loading={run.isPending} disabled={!inRange} onClick={() => run.mutate()}>{existing ? "Re-run" : "Explain differences"}</Button>}
      />
      <div className="p-4">
        {!inRange && <p className="mb-3 text-sm text-warn">Commit B must be within the analyzed range for Gemma context.</p>}
        {run.isError && <ErrorState className="mb-3" error={run.error} />}
        {existing ? <AnalysisCard analysis={existing} /> : !run.isPending && <EmptyState icon={<Brain className="h-5 w-5" />} title="No semantic analysis yet" description="Gemma receives the diff between A and B (bounded), risk signals and evidence IDs." />}
        {run.isPending && <Skeleton className="h-40" />}
      </div>
    </Panel>
  );
}

export type { Commit };
