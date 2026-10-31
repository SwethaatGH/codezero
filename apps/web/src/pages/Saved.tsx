import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Copy, FolderOpen, NotebookPen, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Investigation, InvestigationMode, InvestigationStatus } from "@code-zero/shared";
import { MODE_LABELS } from "@code-zero/shared";
import { api } from "../lib/api";
import { qk, useInvestigations } from "../lib/queries";
import { useSelection } from "../lib/selection";
import { cn, fmtDate, relTime, short } from "../lib/utils";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageTitle, Panel, ScoreBadge, Select, Skeleton, StatusDot, Textarea } from "../components/ui";

type Sort = "updated" | "created" | "name" | "risk";

export default function Saved() {
  const invs = useInvestigations();
  const qc = useQueryClient();
  const { go } = useSelection();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<InvestigationStatus | "">("");
  const [mode, setMode] = useState<InvestigationMode | "">("");
  const [sort, setSort] = useState<Sort>("updated");
  const [renaming, setRenaming] = useState<Investigation | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Investigation | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.investigations });
  const rename = useMutation({ mutationFn: () => api.updateInvestigation(renaming!.id, { name: newName }), onSuccess: (i) => { qc.setQueryData(qk.investigation(i.id), i); refresh(); setRenaming(null); toast.success("Renamed"); }, onError: (e) => toast.error((e as Error).message) });
  const del = useMutation({ mutationFn: () => api.deleteInvestigation(deleting!.id), onSuccess: () => { refresh(); setDeleting(null); toast.success("Investigation deleted"); }, onError: (e) => toast.error((e as Error).message) });
  const dup = useMutation({ mutationFn: (id: string) => api.duplicateInvestigation(id), onSuccess: (i) => { refresh(); toast.success("Duplicated", { description: `${i.name} — resume to analyze` }); } });
  const resume = useMutation({ mutationFn: (id: string) => api.analyze(id), onSuccess: (_, id) => { void qc.invalidateQueries({ queryKey: qk.investigation(id) }); refresh(); go("/portal", { inv: id }); }, onError: (e) => toast.error((e as Error).message) });

  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return (invs.data ?? [])
      .filter((i) => (!ql || `${i.name} ${i.repoFullName} ${i.branch} ${i.id}`.toLowerCase().includes(ql)) && (!status || i.status === status) && (!mode || i.mode === mode))
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : sort === "risk" ? (b.findings[0]?.score ?? -1) - (a.findings[0]?.score ?? -1) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [invs.data, q, status, mode, sort]);

  return (
    <>
      <PageTitle themed="Saved Investigations" technical="Case files · SQLite persistence" description="Every investigation is persisted with its commit range, findings, notes, bookmarks and reports." />
      <Panel className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <Input aria-label="Search investigations" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, repository, branch…" className="w-64" />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as InvestigationStatus | "")} className="w-40">
          <option value="">All statuses</option>
          {["created", "running", "completed", "failed", "cancelled"].map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select aria-label="Filter by mode" value={mode} onChange={(e) => setMode(e.target.value as InvestigationMode | "")} className="w-48">
          <option value="">All modes</option>
          {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-44">
          <option value="updated">Last updated</option>
          <option value="created">Created</option>
          <option value="name">Name</option>
          <option value="risk">Highest risk</option>
        </Select>
        <span className="ml-auto text-xs text-ink-3">{list.length} of {invs.data?.length ?? 0}</span>
      </Panel>
      {invs.isLoading ? <Skeleton className="h-64" /> : invs.isError ? <ErrorState error={invs.error} onRetry={() => invs.refetch()} /> : list.length === 0 ? (
        <Panel><EmptyState icon={<FolderOpen className="h-5 w-5" />} title="No investigations match" action={<Button variant="primary" onClick={() => go("/portal")}>Start an investigation</Button>} /></Panel>
      ) : (
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <li key={i.id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <StatusDot tone={i.status === "completed" ? "healthy" : i.status === "running" ? "cyan" : i.status === "failed" ? "crit" : i.status === "cancelled" ? "warn" : "unknown"} pulse={i.status === "running"} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === i.id ? null : i.id)} aria-expanded={expanded === i.id}>
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{i.name}</span>
                      {i.isDemo && <Badge tone="warn">demo</Badge>}
                      <Badge tone="neutral">{i.status}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-3">
                      {i.repoFullName}@{i.branch} · {MODE_LABELS[i.mode].title} · {short(i.commitRange.from)}…{short(i.commitRange.to)} ({i.commitRange.count}) · updated {relTime(i.updatedAt)}
                    </div>
                  </button>
                  {i.findings[0] ? <ScoreBadge score={i.findings[0].score} /> : <span className="text-xs text-ink-3">no findings</span>}
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => go("/mission", { inv: i.id, commit: null, a: null, b: null })}>Reopen</Button>
                    {i.status !== "completed" && i.status !== "running" && <Button size="sm" variant="outline" icon={<Play className="h-3.5 w-3.5" />} loading={resume.isPending && resume.variables === i.id} onClick={() => resume.mutate(i.id)}>Resume</Button>}
                    <Button size="icon" variant="ghost" aria-label="Rename" onClick={() => { setRenaming(i); setNewName(i.name); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Duplicate" onClick={() => dup.mutate(i.id)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleting(i)}><Trash2 className="h-3.5 w-3.5 text-crit" /></Button>
                  </div>
                </div>
                {expanded === i.id && <Details inv={i} />}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename investigation">
        <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) rename.mutate(); }}>
          <Input aria-label="New name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button type="submit" variant="primary" loading={rename.isPending}>Save</Button></div>
        </form>
      </Modal>
      <ConfirmDialog open={!!deleting} danger title="Delete investigation?" confirmLabel="Delete" loading={del.isPending} onCancel={() => setDeleting(null)} onConfirm={() => del.mutate()} description={<>This permanently deletes <strong className="text-ink">{deleting?.name}</strong>, its analysis, AI results, treatments and reports.</>} />
    </>
  );
}

function Details({ inv }: { inv: Investigation }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const { go } = useSelection();
  const save = useMutation({
    mutationFn: (notes: Investigation["notes"]) => api.updateInvestigation(inv.id, { notes }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.investigations }); setNote(""); },
  });
  return (
    <div className="grid gap-4 border-t border-line bg-obsidian/30 px-4 py-3 text-xs md:grid-cols-3">
      <div>
        <div className="mb-1 font-semibold text-ink-2">Details</div>
        <div className="space-y-0.5 text-ink-3">
          <div>ID <code className="font-mono text-ink-2">{inv.id}</code></div>
          <div>Created {fmtDate(inv.createdAt)}</div>
          <div>Selected commit <code className="font-mono text-cyan">{short(inv.selectedCommitSha)}</code></div>
          <div>Findings {inv.findings.length} · Reports {inv.reportIds.length}</div>
          {inv.params.symptoms && <div className="line-clamp-3">Symptoms: {inv.params.symptoms}</div>}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1 font-semibold text-ink-2"><Bookmark className="h-3 w-3" />Bookmarks ({inv.bookmarks.length})</div>
        <ul className="space-y-0.5">
          {inv.bookmarks.map((b) => <li key={b.sha}><button className="text-left hover:underline" onClick={() => go("/timeline", { inv: inv.id, commit: b.sha })}><code className="font-mono text-cyan">{short(b.sha)}</code> <span className="text-ink-2">{b.label}</span></button></li>)}
          {inv.bookmarks.length === 0 && <li className="text-ink-3">Bookmark commits from the timeline drawer.</li>}
        </ul>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1 font-semibold text-ink-2"><NotebookPen className="h-3 w-3" />Notes ({inv.notes.length})</div>
        <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto">
          {inv.notes.map((n) => (
            <li key={n.id} className="group flex gap-1 rounded bg-white/[0.03] px-2 py-1 text-ink-2">
              <span className="flex-1 whitespace-pre-wrap">{n.text}</span>
              <button className="text-ink-3 opacity-0 group-hover:opacity-100" aria-label="Delete note" onClick={() => save.mutate(inv.notes.filter((x) => x.id !== n.id))}><Trash2 className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
        <form className={cn("flex gap-1")} onSubmit={(e) => { e.preventDefault(); if (note.trim()) save.mutate([...inv.notes, { id: crypto.randomUUID(), text: note.trim(), commitSha: inv.selectedCommitSha, createdAt: new Date().toISOString() }]); }}>
          <Textarea aria-label="New note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="min-h-8 text-xs" />
          <Button size="sm" type="submit" loading={save.isPending}>Add</Button>
        </form>
      </div>
    </div>
  );
}
