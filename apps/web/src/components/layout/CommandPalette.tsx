import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Brain, FileCode2, FileText, FlaskRound, FolderSearch, GitCommit, GitCompare, Play, Radar, Siren } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { useSelection } from "../../lib/selection";
import { useUI } from "../../lib/store";
import { ALL_NAV } from "./nav";
import { Kbd } from "../ui";
import { short } from "../../lib/utils";

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const item = "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 aria-selected:bg-cyan/10 aria-selected:text-ink";
const group = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-ink-3";

export function CommandPalette() {
  const open = useUI((s) => s.commandOpen);
  const setOpen = useUI((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const { go, invId } = useSelection();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const search = useQuery({ queryKey: ["search", dq], queryFn: () => api.search(dq), enabled: open && dq.trim().length >= 2 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUI.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (!open) return null;
  const run = (fn: () => void) => {
    setOpen(false);
    setQ("");
    fn();
  };
  const r = search.data;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-obsidian/70 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <Command label="Command palette" className="glass w-full max-w-xl overflow-hidden rounded-xl shadow-2xl" shouldFilter={dq.trim().length < 2} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <FolderSearch className="h-4 w-4 text-ink-3" />
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search commits, files, functions, findings — or type a command…" className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">{search.isFetching ? "Searching…" : "No results."}</Command.Empty>

          {r && dq.trim().length >= 2 && (
            <>
              {r.findings.length > 0 && (
                <Command.Group heading="Findings" className={group}>
                  {r.findings.map((f) => (
                    <Command.Item key={`f${f.investigationId}${f.commitSha}`} value={`finding ${f.title} ${f.commitSha}`} className={item} onSelect={() => run(() => go("/breakage", { inv: f.investigationId, commit: f.commitSha }))}>
                      <Siren className="h-4 w-4 text-crit" /> <span className="truncate">{f.title}</span> <span className="ml-auto font-mono text-xs">{f.score}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r.commits.length > 0 && (
                <Command.Group heading="Commits" className={group}>
                  {r.commits.map((c) => (
                    <Command.Item key={`c${c.investigationId}${c.sha}`} value={`commit ${c.sha} ${c.message}`} className={item} onSelect={() => run(() => go("/timeline", { inv: c.investigationId, commit: c.sha }))}>
                      <GitCommit className="h-4 w-4 text-cyan" /> <span className="font-mono text-xs text-cyan">{short(c.sha)}</span> <span className="truncate">{c.message}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r.files.length > 0 && (
                <Command.Group heading="Files" className={group}>
                  {r.files.map((f) => (
                    <Command.Item key={`p${f.investigationId}${f.path}`} value={`file ${f.path}`} className={item} onSelect={() => run(() => navigate(`/timeline?inv=${f.investigationId}&file=${encodeURIComponent(f.path)}`))}>
                      <FileCode2 className="h-4 w-4 text-bio" /> <span className="truncate font-mono text-xs">{f.path}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r.functions.length > 0 && (
                <Command.Group heading="Functions" className={group}>
                  {r.functions.map((f) => (
                    <Command.Item key={`fn${f.investigationId}${f.id}`} value={`function ${f.name} ${f.filePath}`} className={item} onSelect={() => run(() => navigate(`/infection?inv=${f.investigationId}&node=${encodeURIComponent(f.id)}`))}>
                      <FlaskRound className="h-4 w-4 text-teal" /> <span className="font-mono text-xs">{f.name}</span> <span className="truncate text-xs text-ink-3">{f.filePath}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r.investigations.length > 0 && (
                <Command.Group heading="Saved investigations" className={group}>
                  {r.investigations.map((i) => (
                    <Command.Item key={`i${i.id}`} value={`investigation ${i.name} ${i.repo}`} className={item} onSelect={() => run(() => go("/mission", { inv: i.id, commit: null, a: null, b: null }))}>
                      <FileText className="h-4 w-4" /> <span className="truncate">{i.name}</span> <span className="ml-auto text-xs text-ink-3">{i.repo}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </>
          )}

          <Command.Group heading="Actions" className={group}>
            <Command.Item className={item} onSelect={() => run(() => navigate("/portal"))}>
              <Radar className="h-4 w-4" /> Open repository / start investigation
            </Command.Item>
            <Command.Item
              className={item}
              onSelect={() =>
                run(async () => {
                  try {
                    const inv = await api.launchDemo();
                    go("/mission", { inv: inv.id, commit: null, a: null, b: null });
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                })
              }
            >
              <Play className="h-4 w-4 text-bio" /> Launch demo investigation
            </Command.Item>
            {invId && (
              <>
                <Command.Item className={item} onSelect={() => run(() => go("/divergence"))}>
                  <GitCompare className="h-4 w-4" /> Compare versions
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => go("/gemma"))}>
                  <Brain className="h-4 w-4" /> Open AI assistant
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => go("/reports", { }))}>
                  <FileText className="h-4 w-4" /> Generate report
                </Command.Item>
              </>
            )}
          </Command.Group>
          <Command.Group heading="Navigate" className={group}>
            {ALL_NAV.map((n) => (
              <Command.Item key={n.path} value={`go ${n.label} ${n.tech}`} className={item} onSelect={() => run(() => go(n.path))}>
                <n.icon className="h-4 w-4 text-ink-3" /> {n.label} <span className="text-xs text-ink-3">— {n.tech}</span>
                {n.key && <span className="ml-auto"><Kbd>g {n.key}</Kbd></span>}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
