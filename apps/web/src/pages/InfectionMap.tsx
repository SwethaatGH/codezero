import { memo, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import dagre from "@dagrejs/dagre";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Brain, ChevronDown, ChevronRight, FileCode2, Maximize2, Network, Pause, Play, RotateCcw, Search, SquareFunction, TestTube2, X } from "lucide-react";
import type { BlastRadius, DependencyGraph, DependencyNode, Investigation } from "@code-zero/shared";
import { api } from "../lib/api";
import { useImpact, useTimeline } from "../lib/queries";
import { useMotionOff } from "../lib/store";
import { cn, firstLine, languageForPath, scoreColor, short } from "../lib/utils";
import { Badge, Button, EmptyState, ErrorState, Input, Modal, PageTitle, Panel, PanelHeader, Select, Sha, SimulatedBanner, Skeleton } from "../components/ui";
import { InvestigationGate, useActiveInvestigation } from "../components/investigation";

export default function InfectionMap() {
  return (
    <>
      <PageTitle themed="Infection Map" technical="Dependency & impact graph" description="Real relationships extracted from source (AST imports and calls). Highlighted spread is POTENTIAL impact through static dependencies — not confirmed breakage." />
      <InvestigationGate>{(inv) => <ReactFlowProvider><MapView inv={inv} /></ReactFlowProvider>}</InvestigationGate>
    </>
  );
}

type NState = "healthy" | "modified" | "high-risk" | "affected-call" | "affected-import" | "unknown";
interface GNodeData extends Record<string, unknown> {
  node: DependencyNode;
  state: NState;
  depth: number | null;
  revealed: boolean;
  expandable: boolean;
  expanded: boolean;
  childCount: number;
  dim: boolean;
  focus: boolean;
  onToggle: (id: string) => void;
}

const STATE_CLS: Record<NState, string> = {
  healthy: "border-line-2 bg-panel/95",
  modified: "border-crit bg-crit/[0.12] glow-crit",
  "high-risk": "border-crit bg-crit/[0.2] glow-crit",
  "affected-call": "border-warn bg-warn/[0.1]",
  "affected-import": "border-warn/50 bg-warn/[0.05] border-dashed",
  unknown: "border-unknown/50 border-dashed bg-panel/80",
};

const GNode = memo(function GNode({ id, data }: NodeProps<Node<GNodeData>>) {
  const { node, state, depth, revealed, expandable, expanded, childCount, dim, focus, onToggle } = data;
  const isFile = node.kind === "file";
  const effective: NState = revealed ? state : state === "modified" || state === "high-risk" ? state : "healthy";
  return (
    <div className={cn("rounded-lg border px-2.5 py-1.5 shadow-md transition-all duration-500", STATE_CLS[effective], isFile ? "w-[210px]" : "w-[180px]", dim && "opacity-20", focus && "ring-2 ring-cyan ring-offset-2 ring-offset-obsidian")}>
      {/* Dependencies are laid out to the left of their dependents, so edges leave a node on its left side. */}
      <Handle type="target" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-line-2" />
      <Handle type="source" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-line-2" />
      <div className="flex items-center gap-1.5">
        {expandable ? (
          <button className="nodrag text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); onToggle(id); }} aria-label={expanded ? "Collapse functions" : "Expand functions"}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        {isFile ? <FileCode2 className={cn("h-3.5 w-3.5 shrink-0", node.isTest ? "text-bio" : "text-cyan")} /> : <SquareFunction className="h-3.5 w-3.5 shrink-0 text-teal" />}
        <span className={cn("truncate font-mono text-[11.5px]", isFile ? "text-ink" : "text-ink-2")} title={node.filePath ?? node.label}>{node.label}</span>
        {expandable && !expanded && childCount > 0 && <span className="ml-auto font-mono text-[9px] text-ink-3">{childCount}ƒ</span>}
      </div>
      {isFile && <div className="truncate pl-5 font-mono text-[9.5px] text-ink-3">{node.module}{node.isTest ? " · test" : ""}</div>}
      {revealed && depth !== null && depth > 0 && <div className="pl-5 font-mono text-[9px] text-warn">hop {depth}</div>}
    </div>
  );
});
const nodeTypes = { g: GNode };

function layout(nodes: Node<GNodeData>[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 55, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.data.node.kind === "file" ? 210 : 180, height: n.data.node.kind === "file" ? 46 : 32 });
  // dependency (target) → dependent (source): dependencies sit to the left.
  for (const e of edges) g.setEdge(e.target, e.source, { weight: 1 });
  // Keep expanded functions in the rank right after their file.
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.data.node.parentId && ids.has(n.data.node.parentId)) g.setEdge(n.data.node.parentId, n.id, { weight: 4, minlen: 1 });
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } };
  });
}

function MapView({ inv }: { inv: Investigation }) {
  const { commitSha, selectCommit, go } = useActiveInvestigation();
  const [params] = useSearchParams();
  const tl = useTimeline(inv);
  const sha = (commitSha && tl.data?.commits.find((c) => c.sha.startsWith(commitSha))?.sha) ?? inv.findings[0]?.commitSha ?? tl.data?.commits[0]?.sha ?? null;
  const impact = useImpact(inv, sha);
  const rf = useReactFlow();
  const motionOff = useMotionOff();

  const graph = impact.data?.graph ?? null;
  const br = impact.data?.blastRadius ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moduleFilter, setModuleFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("node"));
  const [highlight, setHighlight] = useState<"none" | "deps" | "dependents">("none");
  const [scope, setScope] = useState<"affected" | "all">("affected");
  const [step, setStep] = useState<number>(99);
  const [playing, setPlaying] = useState(false);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const maxDepth = useMemo(() => Math.max(0, ...(br?.affected ?? []).map((a) => a.depth)), [br]);
  const assessment = tl.data?.assessments.find((a) => a.commitSha === sha);
  const commit = tl.data?.commits.find((c) => c.sha === sha);

  // Expand files that contain modified or affected functions by default.
  useEffect(() => {
    if (!graph || !br) return;
    const s = new Set<string>();
    for (const id of [...br.seeds, ...br.affected.map((a) => a.id)]) {
      const n = byId.get(id);
      if (n?.kind !== "file" && n?.parentId) s.add(n.parentId);
    }
    setExpanded(s);
    setScope(graph.nodes.filter((n) => n.kind === "file").length > 60 ? "affected" : "all");
    setStep(motionOff ? 99 : 0);
    setPlaying(!motionOff);
  }, [graph, br, byId, motionOff]);

  // Propagation animation: reveal one hop at a time.
  useEffect(() => {
    if (!playing) return;
    if (step > maxDepth) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [playing, step, maxDepth]);

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const modules = useMemo(() => [...new Set((graph?.nodes ?? []).map((n) => n.module))].sort(), [graph]);
  const children = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of graph?.nodes ?? []) if (n.parentId) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n.id]);
    return m;
  }, [graph]);

  const view = useMemo(() => {
    if (!graph || !br) return { nodes: [] as Node<GNodeData>[], edges: [] as Edge[] };
    const seeds = new Set(br.seeds);
    const aff = new Map(br.affected.map((a) => [a.id, a]));
    const highRisk = (assessment?.score ?? 0) >= 60;
    const fileHasEdges = new Set(graph.edges.filter((e) => e.kind !== "contains").flatMap((e) => [e.source, e.target]));
    const affectedFiles = new Set<string>();
    for (const id of [...seeds, ...aff.keys()]) {
      const n = byId.get(id);
      if (n) affectedFiles.add(n.kind === "file" ? n.id : (n.parentId ?? n.id));
    }
    // neighbors of affected files for context
    const context = new Set(affectedFiles);
    for (const e of graph.edges) if (e.kind === "import" && (affectedFiles.has(e.source) || affectedFiles.has(e.target))) { context.add(e.source); context.add(e.target); }

    const visibleOf = (id: string): string | null => {
      const n = byId.get(id);
      if (!n) return null;
      const fileId = n.kind === "file" ? n.id : n.parentId!;
      const f = byId.get(fileId);
      if (!f) return null;
      if (moduleFilter && f.module !== moduleFilter) return null;
      if (scope === "affected" && !context.has(fileId)) return null;
      return n.kind === "file" || !expanded.has(fileId) ? fileId : n.id;
    };
    const stateOf = (id: string): NState => {
      const n = byId.get(id)!;
      if (seeds.has(id)) return highRisk ? "high-risk" : "modified";
      const a = aff.get(id);
      if (a) return a.via === "call" ? "affected-call" : "affected-import";
      if (n.kind === "file" && !fileHasEdges.has(id) && !(children.get(id) ?? []).some((c) => fileHasEdges.has(c))) return "unknown";
      return "healthy";
    };

    const q = query.trim().toLowerCase();
    const nodeIds = new Set<string>();
    for (const n of graph.nodes) {
      const v = visibleOf(n.id);
      if (v) nodeIds.add(v);
    }
    // highlight sets
    const hl = new Set<string>();
    if (selected && highlight !== "none") {
      const stack = [selected];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of graph.edges) {
          if (e.kind === "contains") continue;
          const next = highlight === "deps" ? (e.source === cur ? e.target : null) : e.target === cur ? e.source : null;
          if (next && !hl.has(next)) { hl.add(next); stack.push(next); }
        }
      }
      hl.add(selected);
    }

    const nodes: Node<GNodeData>[] = [...nodeIds].map((id) => {
      const n = byId.get(id)!;
      const a = aff.get(id);
      const depth = seeds.has(id) ? 0 : (a?.depth ?? null);
      const kids = children.get(id) ?? [];
      const matchesQ = !q || n.label.toLowerCase().includes(q) || (n.filePath ?? "").toLowerCase().includes(q);
      return {
        id,
        type: "g",
        position: { x: 0, y: 0 },
        data: {
          node: n,
          state: stateOf(id),
          depth,
          revealed: depth !== null && depth <= step,
          expandable: n.kind === "file" && kids.length > 0,
          expanded: expanded.has(id),
          childCount: kids.length,
          dim: (!!q && !matchesQ) || (hl.size > 0 && !hl.has(id)),
          focus: id === selected || (!!q && matchesQ),
          onToggle: toggle,
        },
      };
    });

    const edgeMap = new Map<string, Edge>();
    const affectedPath = new Set(br.affected.flatMap((a) => a.pathEdgeIds));
    for (const e of graph.edges) {
      if (e.kind === "contains") continue;
      const s = visibleOf(e.source);
      const t = visibleOf(e.target);
      if (!s || !t || s === t) continue;
      const id = `${s}->${t}`;
      const onPath = affectedPath.has(e.id);
      const prev = edgeMap.get(id);
      const heuristic = /Heuristic/.test(e.evidence.description);
      const targetDepth = seeds.has(e.target) ? 0 : (aff.get(e.target)?.depth ?? 99);
      const revealed = onPath && targetDepth < step;
      if (prev && !(onPath && !prev.data?.onPath)) continue;
      edgeMap.set(id, {
        id,
        source: s,
        target: t,
        data: { onPath, kind: e.kind, evidence: e.evidence.description },
        animated: revealed,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: revealed ? "#FFCB6B" : "#284558" },
        style: {
          stroke: revealed ? "#FFCB6B" : e.kind === "call" ? "#40E0D0" : "#2f5266",
          strokeWidth: revealed ? 2.2 : e.kind === "call" ? 1.6 : 1.2,
          strokeDasharray: heuristic ? "4 4" : undefined,
          opacity: hl.size && !(hl.has(e.source) && hl.has(e.target)) ? 0.15 : 1,
          filter: revealed ? "drop-shadow(0 0 4px #FFCB6B)" : undefined,
        },
      });
    }
    const edges = [...edgeMap.values()];
    return { nodes: layout(nodes, edges), edges };
  }, [graph, br, expanded, moduleFilter, query, selected, highlight, scope, step, byId, children, assessment]);

  // Fit only after React Flow has measured the nodes; fitting earlier uses zero-size bounds.
  const measured = useNodesInitialized();
  useEffect(() => {
    if (measured) void rf.fitView({ padding: 0.12, maxZoom: 1.4, duration: motionOff ? 0 : 300 });
  }, [measured, view.nodes.length, rf, motionOff]);

  if (impact.isLoading || tl.isLoading) return <Skeleton className="h-[640px]" />;
  if (impact.isError) return <ErrorState error={impact.error} onRetry={() => impact.refetch()} />;
  if (!graph || !br) return <Panel><EmptyState icon={<Network className="h-5 w-5" />} title="Dependency graph unavailable" description={br?.notes.join(" ") ?? "The file tree could not be loaded for this investigation."} /></Panel>;

  const sel = selected ? byId.get(selected) : null;
  const searchHit = () => {
    const q = query.trim().toLowerCase();
    const hit = view.nodes.find((n) => n.data.node.label.toLowerCase().includes(q) || (n.data.node.filePath ?? "").toLowerCase().includes(q));
    if (hit) {
      setSelected(hit.id);
      void rf.setCenter(hit.position.x + 100, hit.position.y + 20, { zoom: 1.2, duration: motionOff ? 0 : 500 });
    }
  };

  return (
    <div className="space-y-3">
      {inv.isDemo && <SimulatedBanner />}
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Mutation
          <Select aria-label="Commit to propagate" value={sha ?? ""} onChange={(e) => selectCommit(e.target.value)} className="w-72 font-mono text-xs">
            {(tl.data?.commits ?? []).map((c) => {
              const s = tl.data!.assessments.find((a) => a.commitSha === c.sha)?.score ?? 0;
              return <option key={c.sha} value={c.sha}>{c.shortSha} [{s}] {firstLine(c.message).slice(0, 44)}</option>;
            })}
          </Select>
        </label>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); searchHit(); }}>
          <Input aria-label="Search nodes" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nodes…" className="w-44" />
          <Button size="icon" variant="ghost" type="submit" aria-label="Find node"><Search className="h-4 w-4" /></Button>
        </form>
        <Select aria-label="Filter by module" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="w-40">
          <option value="">All modules</option>
          {modules.map((m) => <option key={m}>{m}</option>)}
        </Select>
        <Select aria-label="Graph scope" value={scope} onChange={(e) => setScope(e.target.value as "affected" | "all")} className="w-44">
          <option value="affected">Affected neighborhood</option>
          <option value="all">Entire graph</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(graph.nodes.filter((n) => n.kind === "file").map((n) => n.id)))}>Expand all</Button>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>Collapse all</Button>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={playing ? "secondary" : "primary"} icon={playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => { if (step > maxDepth) setStep(0); setPlaying((p) => !p); }}>
            {playing ? "Pause" : "Animate spread"}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Reset propagation" onClick={() => { setPlaying(false); setStep(0); }}><RotateCcw className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="Fit to screen" onClick={() => void rf.fitView({ padding: 0.15, duration: 300 })}><Maximize2 className="h-4 w-4" /></Button>
          <span className="w-16 text-right font-mono text-xs text-warn">hop {Math.min(step, maxDepth)}/{maxDepth}</span>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <Panel className="relative h-[640px] overflow-hidden">
          {view.nodes.length === 0 ? (
            <EmptyState title="Nothing to show" description="Adjust the module filter or graph scope." />
          ) : (
            <ReactFlow nodes={view.nodes} edges={view.edges} nodeTypes={nodeTypes} onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)} fitView minZoom={0.1} maxZoom={2} nodesConnectable={false} nodesDraggable proOptions={{ hideAttribution: true }}>
              <Background color="#1d3343" gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
          <GraphLegend graph={graph} />
        </Panel>

        <div className="space-y-3">
          {sel ? (
            <NodePanel inv={inv} node={sel} graph={graph} br={br} highlight={highlight} setHighlight={setHighlight} onClose={() => setSelected(null)} onSource={(p) => setSourceOpen(p)} onAsk={() => go("/gemma", { commit: sha })} onSelectNode={setSelected} />
          ) : null}
          <BlastRadiusPanel br={br} byId={byId} score={assessment?.score ?? null} commitLabel={commit ? `${commit.shortSha} · ${firstLine(commit.message)}` : short(sha)} onSelect={setSelected} />
        </div>
      </div>
      {sourceOpen && <SourceModal inv={inv} path={sourceOpen} ref_={graph.headSha ?? sha!} onClose={() => setSourceOpen(null)} />}
    </div>
  );
}

function GraphLegend({ graph }: { graph: DependencyGraph }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 max-w-[400px] rounded-lg border border-line bg-obsidian/85 p-2.5 text-[10.5px] text-ink-2">
      <div className="mb-1.5 font-mono uppercase tracking-[0.16em] text-ink-3">Legend · {graph.level}-level graph</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm border border-crit bg-crit/20" />Direct code change</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm border border-warn bg-warn/10" />Potential impact (call path)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm border border-dashed border-warn/50" />Potential impact (import only)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm border border-dashed border-unknown/60" />Unknown relationships</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#40E0D0]" />Static call (AST)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#2f5266]" />Static import</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-[#2f5266]" />Heuristic import</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-warn" />Propagation path</span>
      </div>
    </div>
  );
}

function BlastRadiusPanel({ br, byId, score, commitLabel, onSelect }: { br: BlastRadius; byId: Map<string, DependencyNode>; score: number | null; commitLabel: string; onSelect: (id: string) => void }) {
  const label = (id: string) => {
    const n = byId.get(id);
    return n ? (n.kind === "file" ? n.filePath! : `${n.label}()`) : id;
  };
  const tone = br.classification === "wide" ? "crit" : br.classification === "moderate" ? "warn" : br.classification === "contained" ? "healthy" : "unknown";
  const downstream = br.affected.filter((a) => a.depth > 1);
  const List = ({ ids }: { ids: string[] }) => (
    <ul className="space-y-0.5">
      {ids.slice(0, 12).map((id) => (
        <li key={id}><button onClick={() => onSelect(id)} className="truncate font-mono text-[11px] text-cyan hover:underline">{label(id)}</button></li>
      ))}
      {ids.length > 12 && <li className="text-[11px] text-ink-3">+{ids.length - 12} more</li>}
      {ids.length === 0 && <li className="text-[11px] text-ink-3">None</li>}
    </ul>
  );
  return (
    <Panel>
      <PanelHeader title="Blast radius" subtitle={commitLabel} icon={<Network className="h-4 w-4" />} actions={<Badge tone={tone}>{br.classification}</Badge>} />
      <div className="space-y-3 p-4 text-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-line p-2"><div className="font-mono text-lg text-crit">{br.seeds.length}</div><div className="text-[10px] uppercase text-ink-3">changed</div></div>
          <div className="rounded-lg border border-line p-2"><div className="font-mono text-lg text-warn">{br.affected.length}</div><div className="text-[10px] uppercase text-ink-3">potentially affected</div></div>
          <div className="rounded-lg border border-line p-2"><div className="font-mono text-lg" style={{ color: score !== null ? scoreColor(score) : undefined }}>{score ?? "—"}</div><div className="text-[10px] uppercase text-ink-3">commit risk</div></div>
        </div>
        <section><h4 className="mb-1 text-xs text-ink-2">Modified functions (AST)</h4><List ids={br.modifiedFunctions.map((f) => `fn:${f}`)} /></section>
        <section><h4 className="mb-1 text-xs text-ink-2">Direct dependents</h4><List ids={br.directDependents} /></section>
        <section><h4 className="mb-1 text-xs text-ink-2">Potential downstream consumers</h4><List ids={downstream.map((a) => a.id)} /></section>
        <section>
          <h4 className="mb-1 flex items-center gap-1 text-xs text-ink-2"><TestTube2 className="h-3 w-3" />Related tests</h4>
          <ul>{br.relatedTests.length ? br.relatedTests.map((t) => <li key={t} className="font-mono text-[11px] text-bio">{t}</li>) : <li className="text-[11px] text-ink-3">No test files reach the changed code in the graph.</li>}</ul>
        </section>
        {br.notes.length > 0 && <ul className="space-y-0.5 border-t border-line pt-2 text-[11px] text-ink-3">{br.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
      </div>
    </Panel>
  );
}

function NodePanel({ inv, node, graph, br, highlight, setHighlight, onClose, onSource, onAsk, onSelectNode }: { inv: Investigation; node: DependencyNode; graph: DependencyGraph; br: BlastRadius; highlight: string; setHighlight: (h: "none" | "deps" | "dependents") => void; onClose: () => void; onSource: (path: string) => void; onAsk: () => void; onSelectNode: (id: string) => void }) {
  const tl = useTimeline(inv);
  const { go } = useActiveInvestigation();
  const out = graph.edges.filter((e) => e.source === node.id && e.kind !== "contains");
  const inc = graph.edges.filter((e) => e.target === node.id && e.kind !== "contains");
  const aff = br.affected.find((a) => a.id === node.id);
  const related = (tl.data?.commits ?? []).filter((c) => node.filePath && c.files.some((f) => f.path === node.filePath));
  return (
    <Panel glow="cyan">
      <PanelHeader title={node.label} subtitle={`${node.kind} · ${node.filePath ?? ""}`} icon={node.kind === "file" ? <FileCode2 className="h-4 w-4" /> : <SquareFunction className="h-4 w-4" />} actions={<Button size="icon" variant="ghost" aria-label="Close node details" onClick={onClose}><X className="h-4 w-4" /></Button>} />
      <div className="space-y-3 p-4 text-xs">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">{node.module}</Badge>
          {node.language && <Badge tone="neutral">{node.language}</Badge>}
          {br.seeds.includes(node.id) && <Badge tone="crit">Directly modified</Badge>}
          {aff && <Badge tone="warn">Potentially affected · hop {aff.depth} via {aff.via}</Badge>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={highlight === "deps" ? "secondary" : "ghost"} onClick={() => setHighlight(highlight === "deps" ? "none" : "deps")}>Highlight dependencies</Button>
          <Button size="sm" variant={highlight === "dependents" ? "secondary" : "ghost"} onClick={() => setHighlight(highlight === "dependents" ? "none" : "dependents")}>Highlight dependents</Button>
          {node.filePath && <Button size="sm" variant="ghost" icon={<FileCode2 className="h-3.5 w-3.5" />} onClick={() => onSource(node.filePath!)}>Open source</Button>}
          <Button size="sm" variant="ghost" icon={<Brain className="h-3.5 w-3.5" />} onClick={onAsk}>AI explanation</Button>
        </div>
        <section>
          <h4 className="mb-1 text-ink-2">Depends on ({out.length})</h4>
          <ul className="space-y-0.5">{out.slice(0, 10).map((e) => <li key={e.id} title={e.evidence.description}><button className="font-mono text-cyan hover:underline" onClick={() => onSelectNode(e.target)}>{e.target.replace(/^(file|fn):/, "")}</button> <span className="text-ink-3">({e.kind})</span></li>)}</ul>
        </section>
        <section>
          <h4 className="mb-1 text-ink-2">Used by ({inc.length})</h4>
          <ul className="space-y-0.5">{inc.slice(0, 10).map((e) => <li key={e.id} title={e.evidence.description}><button className="font-mono text-cyan hover:underline" onClick={() => onSelectNode(e.source)}>{e.source.replace(/^(file|fn):/, "")}</button> <span className="text-ink-3">({e.kind} · {e.evidence.filePath}:{e.evidence.line})</span></li>)}</ul>
        </section>
        <section>
          <h4 className="mb-1 text-ink-2">Related commits ({related.length})</h4>
          <ul className="space-y-0.5">{related.slice(0, 8).map((c) => <li key={c.sha}><button className="flex gap-2 text-left hover:underline" onClick={() => go("/timeline", { commit: c.sha })}><Sha sha={c.sha} /><span className="truncate text-ink-2">{firstLine(c.message)}</span></button></li>)}</ul>
        </section>
      </div>
    </Panel>
  );
}

function SourceModal({ inv, path, ref_, onClose }: { inv: Investigation; path: string; ref_: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["file", inv.id, path, ref_], queryFn: () => api.file(inv.id, path, ref_), staleTime: Infinity });
  return (
    <Modal open onClose={onClose} title={`${path} @ ${short(ref_)}`} wide>
      {q.isLoading ? <Skeleton className="h-80" /> : q.isError ? <ErrorState error={q.error} /> : q.data?.missing ? <p className="text-sm text-ink-3">File not available at this ref.</p> : (
        <pre className="max-h-[65vh] overflow-auto rounded-lg border border-line bg-obsidian p-3 font-mono text-[12px] leading-5 text-ink" data-lang={languageForPath(path)}>
          {q.data!.content!.split("\n").map((l, i) => <div key={i}><span className="mr-4 inline-block w-8 select-none text-right text-ink-3">{i + 1}</span>{l}</div>)}
        </pre>
      )}
    </Modal>
  );
}
