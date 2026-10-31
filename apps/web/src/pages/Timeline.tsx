import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Panel as RPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Bookmark, ChevronLeft, ChevronRight, FileClock, GitCompare, Pause, Play, RotateCcw, Waypoints } from "lucide-react";
import type { Commit, Investigation, RiskAssessment } from "@code-zero/shared";
import { useTimeline } from "../lib/queries";
import { useMotionOff } from "../lib/store";
import { cn, firstLine, fmtDate, relTime, scoreColor, short } from "../lib/utils";
import { Badge, Button, Chip, EmptyState, Input, PageTitle, Panel, PanelHeader, Select, SimulatedBanner, Skeleton } from "../components/ui";
import { CommitDrawer, InvestigationGate, useActiveInvestigation } from "../components/investigation";

export default function Timeline() {
  return (
    <>
      <PageTitle themed="Temporal Timeline" technical="Commit history" description="Every mutation (commit) in the analyzed range, scored and ordered in time. Click to inspect, Shift+click two commits to compare." />
      <InvestigationGate>{(inv) => <ReactFlowProvider><TimelineView inv={inv} /></ReactFlowProvider>}</InvestigationGate>
    </>
  );
}

type NodeState = "normal" | "suspicious" | "known-good" | "known-bad" | "verified";
interface CommitNodeData extends Record<string, unknown> {
  commit: Commit;
  assessment: RiskAssessment | undefined;
  state: NodeState;
  selected: boolean;
  compare: boolean;
  dimmed: boolean;
  playing: boolean;
  bookmarked: boolean;
  status: string | null;
}

const STATE_STYLE: Record<NodeState, { ring: string; label: string | null; tone: "crit" | "healthy" | "warn" | null }> = {
  normal: { ring: "border-line-2", label: null, tone: null },
  suspicious: { ring: "border-warn/60", label: "Suspicious", tone: "warn" },
  "known-good": { ring: "border-healthy/60", label: "Known good", tone: "healthy" },
  "known-bad": { ring: "border-crit/60", label: "Known bad", tone: "crit" },
  verified: { ring: "border-crit glow-crit", label: "Verified regression", tone: "crit" },
};

const CommitNode = memo(function CommitNode({ data }: NodeProps<Node<CommitNodeData>>) {
  const { commit, assessment, state, selected, compare, dimmed, playing, bookmarked, status } = data;
  const s = STATE_STYLE[state];
  const score = assessment?.score ?? 0;
  const adds = commit.stats?.additions ?? commit.files.reduce((a, f) => a + f.additions, 0);
  const dels = commit.stats?.deletions ?? commit.files.reduce((a, f) => a + f.deletions, 0);
  return (
    <div
      className={cn(
        "w-[220px] rounded-xl border bg-panel/95 p-3 text-left shadow-lg transition-all",
        s.ring,
        selected && "ring-2 ring-cyan ring-offset-2 ring-offset-obsidian",
        compare && "outline outline-2 outline-offset-4 outline-bio/70",
        playing && "scale-[1.04] glow-cyan",
        dimmed && "opacity-25",
      )}
      title={`${commit.sha}\n${commit.message}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-line-2" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-line-2" />
      <div className="flex items-center gap-1.5">
        <code className="font-mono text-[11px] text-cyan">{commit.shortSha}</code>
        {bookmarked && <Bookmark className="h-3 w-3 fill-bio text-bio" />}
        <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ color: scoreColor(score), background: `${scoreColor(score)}1a` }}>
          {score}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">{firstLine(commit.message)}</div>
      <div className="mt-1.5 truncate text-[11px] text-ink-2">
        {commit.author.name} · {relTime(commit.date)}
      </div>
      <div className="mt-2 flex items-center gap-2 font-mono text-[10.5px]">
        <span className="text-ink-3">{commit.files.length} files</span>
        <span className="text-healthy">+{adds}</span>
        <span className="text-crit">−{dels}</span>
        {(s.label || status) && (
          <span className={cn("ml-auto truncate rounded px-1 text-[9.5px] uppercase tracking-wide", s.tone === "crit" ? "bg-crit/15 text-crit" : s.tone === "healthy" ? "bg-healthy/15 text-healthy" : s.tone === "warn" ? "bg-warn/15 text-warn" : "bg-white/5 text-ink-2")}>
            {s.label ?? status}
          </span>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, score)}%`, background: scoreColor(score) }} />
      </div>
    </div>
  );
});
const nodeTypes = { commit: CommitNode };

function TimelineView({ inv }: { inv: Investigation }) {
  const { commitSha, selectCommit, go } = useActiveInvestigation();
  const [params, setParams] = useSearchParams();
  const tl = useTimeline(inv);
  const rf = useReactFlow();
  const motionOff = useMotionOff();

  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");
  const [fileFilter, setFileFilter] = useState(params.get("file") ?? "");
  const [minRisk, setMinRisk] = useState(0);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [compareSel, setCompareSel] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursor, setCursor] = useState(0);
  const [trailFile, setTrailFile] = useState<string>(params.get("file") ?? "");

  const chrono = useMemo(() => [...(tl.data?.commits ?? [])].reverse(), [tl.data]);
  const assess = useMemo(() => new Map((tl.data?.assessments ?? []).map((a) => [a.commitSha, a])), [tl.data]);
  const authors = useMemo(() => [...new Set(chrono.map((c) => c.author.name))].sort(), [chrono]);
  const allFiles = useMemo(() => [...new Set(chrono.flatMap((c) => c.files.map((f) => f.path)))].sort(), [chrono]);

  const matches = (c: Commit) => {
    const a = assess.get(c.sha);
    if (q && !`${c.sha} ${c.message}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (author && c.author.name !== author) return false;
    if (fileFilter && !c.files.some((f) => f.path.toLowerCase().includes(fileFilter.toLowerCase()))) return false;
    if (minRisk && (a?.score ?? 0) < minRisk) return false;
    if (since && c.date < new Date(since).toISOString()) return false;
    if (until && c.date > new Date(`${until}T23:59:59`).toISOString()) return false;
    return true;
  };
  const visible = chrono.filter(matches);
  const activeFilters = [q && `“${q}”`, author && `author: ${author}`, fileFilter && `file: ${fileFilter}`, minRisk && `risk ≥ ${minRisk}`, since && `from ${since}`, until && `to ${until}`].filter(Boolean) as string[];
  const playSha = playing || cursor > 0 ? visible[cursor]?.sha : null;

  const stateOf = (c: Commit): NodeState => {
    if (tl.data?.bisect?.firstBadSha === c.sha) return "verified";
    if (inv.knownBadSha && c.sha.startsWith(inv.knownBadSha)) return "known-bad";
    if (inv.knownGoodSha && c.sha.startsWith(inv.knownGoodSha)) return "known-good";
    if ((assess.get(c.sha)?.score ?? 0) >= 40) return "suspicious";
    return "normal";
  };

  const nodes: Node<CommitNodeData>[] = chrono.map((c, i) => {
    const f = inv.findings.find((x) => x.commitSha === c.sha);
    return {
      id: c.sha,
      type: "commit",
      position: { x: i * 270, y: i % 2 === 0 ? 0 : 70 },
      data: {
        commit: c,
        assessment: assess.get(c.sha),
        state: stateOf(c),
        selected: commitSha ? c.sha.startsWith(commitSha) : false,
        compare: compareSel.includes(c.sha),
        dimmed: !matches(c),
        playing: playSha === c.sha,
        bookmarked: inv.bookmarks.some((b) => b.sha === c.sha),
        status: f ? `Suspect #${f.rank}` : null,
      },
      draggable: false,
    };
  });
  const edges: Edge[] = chrono.slice(1).map((c, i) => ({
    id: `${chrono[i].sha}-${c.sha}`,
    source: chrono[i].sha,
    target: c.sha,
    animated: playSha === c.sha,
    style: { stroke: (assess.get(c.sha)?.score ?? 0) >= 40 ? "#FF5C7A" : "#284558", strokeWidth: 2 },
  }));

  // Playback
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setCursor((c) => {
        if (c >= visible.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 1400 / speed);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, speed, visible.length]);

  useEffect(() => {
    const c = visible[cursor];
    if (!c || (!playing && cursor === 0)) return;
    selectCommit(c.sha);
    const n = nodes.find((x) => x.id === c.sha);
    if (n) void rf.setCenter(n.position.x + 110, n.position.y + 60, { zoom: 1, duration: motionOff ? 0 : 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const selected = commitSha ? (tl.data?.commits.find((c) => c.sha.startsWith(commitSha)) ?? null) : null;

  const onNodeClick = (e: React.MouseEvent, n: Node) => {
    if (e.shiftKey) {
      setCompareSel((s) => (s.includes(n.id) ? s.filter((x) => x !== n.id) : [...s, n.id].slice(-2)));
      return;
    }
    selectCommit(n.id);
    setCursor(Math.max(0, visible.findIndex((c) => c.sha === n.id)));
  };

  const compareNow = () => {
    const [x, y] = compareSel.map((sha) => chrono.findIndex((c) => c.sha === sha)).sort((a, b) => a - b);
    go("/divergence", { a: chrono[x].sha, b: chrono[y].sha, commit: chrono[y].sha });
  };

  const trail = useMemo(() => {
    if (!trailFile) return [];
    return chrono.flatMap((c) => {
      const f = c.files.find((x) => x.path === trailFile || x.previousPath === trailFile);
      if (!f) return [];
      const kind = f.status === "added" ? "Created" : f.status === "removed" ? "Deleted" : f.status === "renamed" ? `Renamed from ${f.previousPath}` : "Modified";
      return [{ commit: c, file: f, kind }];
    });
  }, [chrono, trailFile]);

  if (tl.isLoading) return <Skeleton className="h-[560px]" />;
  if (!tl.data) return null;

  return (
    <div className="space-y-3">
      {inv.isDemo && <SimulatedBanner />}
      {/* Filters */}
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <Input aria-label="Search commits" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SHA or message…" className="w-48" />
        <Select aria-label="Filter by author" value={author} onChange={(e) => setAuthor(e.target.value)} className="w-40">
          <option value="">All authors</option>
          {authors.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
        <Input aria-label="Filter by file" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="File path contains…" className="w-44 font-mono" list="tl-files" />
        <datalist id="tl-files">{allFiles.map((f) => <option key={f} value={f} />)}</datalist>
        <Select aria-label="Minimum risk" value={minRisk} onChange={(e) => setMinRisk(Number(e.target.value))} className="w-36">
          <option value={0}>Any risk</option>
          <option value={20}>Risk ≥ 20</option>
          <option value={40}>Risk ≥ 40</option>
          <option value={60}>Risk ≥ 60</option>
        </Select>
        <Input aria-label="From date" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="w-36" />
        <Input aria-label="To date" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-36" />
        <span className="ml-auto text-xs text-ink-3">
          {visible.length}/{chrono.length} commits
        </span>
        {activeFilters.length > 0 && (
          <div className="flex w-full flex-wrap gap-1.5">
            {activeFilters.map((f) => (
              <Chip key={f} active>{f}</Chip>
            ))}
            <Chip onClick={() => { setQ(""); setAuthor(""); setFileFilter(""); setMinRisk(0); setSince(""); setUntil(""); }}>Clear all</Chip>
          </div>
        )}
      </Panel>

      {/* Playback */}
      <Panel className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button size="icon" variant="ghost" aria-label="Previous commit" onClick={() => setCursor((c) => Math.max(0, c - 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant={playing ? "secondary" : "primary"} aria-label={playing ? "Pause" : "Play"} onClick={() => { if (cursor >= visible.length - 1) setCursor(0); setPlaying((p) => !p); }}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" aria-label="Next commit" onClick={() => setCursor((c) => Math.min(visible.length - 1, c + 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="Reset playback" onClick={() => { setPlaying(false); setCursor(0); void rf.fitView({ duration: motionOff ? 0 : 400 }); }}><RotateCcw className="h-4 w-4" /></Button>
        <Select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 w-20 text-xs">
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </Select>
        <input aria-label="Timeline scrubber" type="range" min={0} max={Math.max(0, visible.length - 1)} value={cursor} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} className="mx-2 min-w-40 flex-1 accent-[#40E0D0]" />
        <span className="w-48 truncate font-mono text-xs text-ink-2">{visible[cursor] ? `${short(visible[cursor].sha)} · ${fmtDate(visible[cursor].date)}` : "—"}</span>
        <Button size="sm" variant="outline" icon={<GitCompare className="h-3.5 w-3.5" />} disabled={compareSel.length !== 2} onClick={compareNow} title="Shift+click two commits to select them">
          Compare {compareSel.length}/2
        </Button>
      </Panel>

      <div className="h-[560px]">
        <PanelGroup direction="horizontal" autoSaveId="timeline-split">
          <RPanel defaultSize={selected ? 64 : 100} minSize={40}>
            <Panel className="relative h-full overflow-hidden">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}
                onInit={(inst) => {
                  // Start centered on the selected commit (or Patient Zero) at a readable zoom rather than fitting all.
                  const focusSha = (commitSha && chrono.find((c) => c.sha.startsWith(commitSha))?.sha) ?? inv.findings[0]?.commitSha ?? chrono[chrono.length - 1]?.sha;
                  const n = nodes.find((x) => x.id === focusSha);
                  if (n) void inst.setCenter(n.position.x + 110, n.position.y + 60, { zoom: 0.9 });
                  else void inst.fitView({ padding: 0.2 });
                }}
                minZoom={0.15}
                maxZoom={1.6}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#1d3343" gap={24} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
              <Legend />
            </Panel>
          </RPanel>
          {selected && (
            <>
              <PanelResizeHandle className="mx-1 w-1 rounded bg-line transition-colors hover:bg-cyan/50" />
              <RPanel defaultSize={36} minSize={25}>
                <CommitDrawer inv={inv} commit={selected} assessment={assess.get(selected.sha)} onClose={() => selectCommit(null)} />
              </RPanel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* Code change trail */}
      <Panel>
        <PanelHeader
          title="Code change trail"
          subtitle="Evolution of a single file across the analyzed commits"
          icon={<FileClock className="h-4 w-4" />}
          actions={
            <Select aria-label="File for change trail" value={trailFile} onChange={(e) => { setTrailFile(e.target.value); const n = new URLSearchParams(params); if (e.target.value) n.set("file", e.target.value); else n.delete("file"); setParams(n, { replace: true }); }} className="h-8 w-72 font-mono text-xs">
              <option value="">Select a file…</option>
              {allFiles.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          }
        />
        {!trailFile ? (
          <EmptyState icon={<Waypoints className="h-5 w-5" />} title="Pick a file" description="See when it was created, modified, renamed or deleted — with commit references." className="py-8" />
        ) : (
          <ol className="relative space-y-0 p-4 pl-8">
            <span className="absolute bottom-6 left-[19px] top-6 w-px bg-line-2" />
            {trail.map(({ commit, file, kind }) => {
              const sc = assess.get(commit.sha)?.score ?? 0;
              return (
                <li key={commit.sha} className="relative pb-3">
                  <span className="absolute -left-[17px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-obsidian" style={{ background: kind === "Created" ? "#39D98A" : kind === "Deleted" ? "#FF5C7A" : "#40E0D0" }} />
                  <button className="flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.03]" onClick={() => selectCommit(commit.sha)}>
                    <Badge tone={kind === "Created" ? "healthy" : kind === "Deleted" ? "crit" : "cyan"}>{kind}</Badge>
                    <code className="font-mono text-xs text-cyan">{commit.shortSha}</code>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{firstLine(commit.message)}</span>
                    <span className="font-mono text-xs text-healthy">+{file.additions}</span>
                    <span className="font-mono text-xs text-crit">−{file.deletions}</span>
                    <span className="font-mono text-xs" style={{ color: scoreColor(sc) }}>{sc}</span>
                    <span className="text-xs text-ink-3">{fmtDate(commit.date)}</span>
                  </button>
                </li>
              );
            })}
            {trail.length === 0 && <li className="text-sm text-ink-3">This file was not changed in the analyzed commits.</li>}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function Legend() {
  const items = [
    ["border-line-2", "Normal"],
    ["border-warn/60", "Suspicious (≥40)"],
    ["border-healthy/60", "Known good"],
    ["border-crit/60", "Known bad"],
    ["border-crit glow-crit", "Verified regression"],
  ];
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2 rounded-lg border border-line bg-obsidian/80 px-2.5 py-1.5 text-[10.5px] text-ink-2">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-3.5 rounded-sm border-2 bg-panel", c)} />
          {l}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm ring-2 ring-cyan" />Selected</span>
    </div>
  );
}
