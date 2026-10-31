import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Database, Github, MonitorCog, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { InvestigationMode } from "@code-zero/shared";
import { MODE_LABELS } from "@code-zero/shared";
import { api, type Settings as S } from "../lib/api";
import { qk, useAIStatus, useSettings } from "../lib/queries";
import { useUI } from "../lib/store";
import { Badge, Button, ConfirmDialog, Field, Input, PageTitle, Panel, PanelHeader, Select, Skeleton, StatusDot } from "../components/ui";

export default function Settings() {
  const settings = useSettings();
  const ai = useAIStatus();
  const gh = useQuery({ queryKey: ["github-status"], queryFn: api.githubStatus });
  const qc = useQueryClient();
  const ui = useUI();
  const [form, setForm] = useState<S | null>(null);
  const [confirm, setConfirm] = useState<"all" | "cache" | null>(null);
  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);

  const save = useMutation({
    mutationFn: (s: Partial<S>) => api.saveSettings(s),
    onSuccess: (s) => { qc.setQueryData(qk.settings, { ...settings.data, ...s }); void qc.invalidateQueries({ queryKey: qk.aiStatus }); toast.success("Settings saved"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const test = useMutation({
    mutationFn: () => api.aiStatus(true),
    onSuccess: (s) => { qc.setQueryData(qk.aiStatus, s); (s.state === "connected" ? toast.success : toast.error)(s.message); },
  });
  const clear = useMutation({
    mutationFn: (scope: "all" | "cache") => api.clearData(scope),
    onSuccess: (_, scope) => { void qc.invalidateQueries(); setConfirm(null); if (scope === "all") ui.setLastInvestigation(null); toast.success(scope === "all" ? "All investigations deleted" : "Cache cleared"); },
  });

  if (!form) return <Skeleton className="h-96" />;
  const set = <K extends keyof S>(k: K, v: S[K]) => setForm({ ...form, [k]: v });

  return (
    <>
      <PageTitle themed="Settings" technical="System configuration" description="Server-side configuration for GitHub and Gemma, plus interface preferences. Secrets stay on the backend." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Gemma 4 connection" subtitle="AI provider used by the backend" icon={<Brain className="h-4 w-4" />} actions={<span className="flex items-center gap-1.5 text-xs text-ink-2"><StatusDot tone={ai.data?.state === "connected" ? "healthy" : ai.data?.state === "model-missing" ? "warn" : "crit"} />{ai.data?.state ?? "checking"}</span>} />
          <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ aiProvider: form.aiProvider, ollamaBaseUrl: form.ollamaBaseUrl, ollamaModel: form.ollamaModel, geminiModel: form.geminiModel }); }}>
            <Field label="Provider" htmlFor="prov">
              <Select id="prov" value={form.aiProvider} onChange={(e) => set("aiProvider", e.target.value as S["aiProvider"])}>
                <option value="ollama">Ollama (local or Ollama cloud)</option>
                <option value="gemini">Gemini API (Gemma models)</option>
              </Select>
            </Field>
            {form.aiProvider === "ollama" ? (
              <>
                <Field label="Ollama endpoint" htmlFor="ourl"><Input id="ourl" value={form.ollamaBaseUrl} onChange={(e) => set("ollamaBaseUrl", e.target.value)} className="font-mono" /></Field>
                <Field label="Model name" hint={ai.data?.availableModels.length ? `Installed: ${ai.data.availableModels.join(", ")}` : "e.g. gemma4, gemma4:e4b"} htmlFor="omodel"><Input id="omodel" value={form.ollamaModel} onChange={(e) => set("ollamaModel", e.target.value)} className="font-mono" /></Field>
              </>
            ) : (
              <>
                <Field label="Gemini model" hint={form.geminiKeyConfigured ? "GEMINI_API_KEY is configured on the server." : "Set GEMINI_API_KEY in the backend .env"} htmlFor="gmodel"><Input id="gmodel" value={form.geminiModel} onChange={(e) => set("geminiModel", e.target.value)} className="font-mono" /></Field>
              </>
            )}
            {ai.data && <p className="rounded-lg border border-line bg-obsidian/40 p-2.5 text-xs text-ink-2">{ai.data.message}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
              <Button type="button" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={test.isPending} onClick={() => test.mutate()}>Test connection</Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="GitHub integration" subtitle="Requests are made only by the backend" icon={<Github className="h-4 w-4" />} />
          <div className="space-y-2 p-4 text-sm">
            {gh.isLoading ? <Skeleton className="h-16" /> : gh.data && (
              <>
                <div className="flex items-center gap-2"><StatusDot tone={gh.data.reachable ? "healthy" : "crit"} />{gh.data.reachable ? "GitHub API reachable" : `Unreachable: ${gh.data.message}`}</div>
                <div className="flex items-center gap-2">{gh.data.authenticated ? <Badge tone="healthy">GITHUB_TOKEN configured</Badge> : <Badge tone="warn">Unauthenticated (60 req/hour)</Badge>}</div>
                {gh.data.limit !== null && <div className="text-xs text-ink-2">Rate limit: <span className="font-mono text-ink">{gh.data.remaining}/{gh.data.limit}</span> remaining · resets {gh.data.reset && new Date(gh.data.reset).toLocaleTimeString()}</div>}
              </>
            )}
            <p className="text-xs text-ink-3">Commit details and file contents are cached in SQLite; raw file fetches use raw.githubusercontent.com and do not count toward the REST quota.</p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Analysis defaults" icon={<SlidersHorizontal className="h-4 w-4" />} />
          <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ defaultCommitLimit: form.defaultCommitLimit, defaultMode: form.defaultMode }); }}>
            <Field label={`Analysis commit limit: ${form.defaultCommitLimit}`} htmlFor="lim"><input id="lim" type="range" min={5} max={100} value={form.defaultCommitLimit} onChange={(e) => set("defaultCommitLimit", Number(e.target.value))} className="w-full accent-[#8BFFB0]" /></Field>
            <Field label="Default investigation mode" htmlFor="dmode">
              <Select id="dmode" value={form.defaultMode} onChange={(e) => set("defaultMode", e.target.value as InvestigationMode)}>
                {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="primary" loading={save.isPending}>Save defaults</Button>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="Interface" subtitle="Stored in this browser" icon={<MonitorCog className="h-4 w-4" />} />
          <div className="space-y-3 p-4 text-sm">
            <Toggle label="Animations" hint="Graph propagation, page transitions, playback camera moves" checked={ui.animations} onChange={ui.setAnimations} />
            <Toggle label="Reduced motion" hint="Disables non-essential motion (also honors your OS setting)" checked={ui.reducedMotion} onChange={ui.setReducedMotion} />
            <Field label="Default explanation level" htmlFor="lvl">
              <Select id="lvl" value={ui.level} onChange={(e) => ui.setLevel(e.target.value as typeof ui.level)}>
                <option value="beginner">Beginner</option><option value="developer">Developer</option><option value="expert">Expert</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader title="Data management" subtitle="SQLite database on the backend" icon={<Database className="h-4 w-4" />} />
          <div className="flex flex-wrap gap-2 p-4">
            <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setConfirm("cache")}>Clear GitHub cache</Button>
            <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("all")}>Delete all investigations & reports</Button>
            <Button variant="ghost" onClick={async () => { await api.resetSettings(); void qc.invalidateQueries({ queryKey: qk.settings }); toast.success("Settings reset to environment defaults"); }}>Reset settings</Button>
            <Button variant="ghost" onClick={() => { ui.clearNotifications(); toast.success("Notifications cleared"); }}>Clear notifications</Button>
          </div>
        </Panel>
      </div>
      <ConfirmDialog open={!!confirm} danger={confirm === "all"} title={confirm === "all" ? "Delete everything?" : "Clear cache?"} confirmLabel={confirm === "all" ? "Delete all" : "Clear cache"} loading={clear.isPending} onCancel={() => setConfirm(null)} onConfirm={() => clear.mutate(confirm!)} description={confirm === "all" ? "All investigations, analyses, AI results, treatments, reports and cached GitHub data will be permanently deleted." : "Cached GitHub responses will be refetched on next use."} />
    </>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span><span className="text-ink">{label}</span><span className="block text-xs text-ink-3">{hint}</span></span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-bio" : "bg-line-2"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-obsidian transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}
