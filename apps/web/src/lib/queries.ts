import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Investigation } from "@code-zero/shared";
import { api, subscribeProgress } from "./api";
import { useUI } from "./store";
import { toast } from "sonner";

export const qk = {
  investigations: ["investigations"] as const,
  investigation: (id: string) => ["investigation", id] as const,
  timeline: (id: string) => ["timeline", id] as const,
  impact: (id: string, sha: string) => ["impact", id, sha] as const,
  health: (id: string) => ["health", id] as const,
  ai: (id: string) => ["ai", id] as const,
  patches: (id: string) => ["patches", id] as const,
  reports: (id?: string) => ["reports", id ?? "all"] as const,
  aiStatus: ["ai-status"] as const,
  settings: ["settings"] as const,
};

export function useInvestigation(id: string | null) {
  return useQuery({
    queryKey: qk.investigation(id ?? "none"),
    queryFn: () => api.investigation(id!),
    enabled: !!id,
    retry: (n, e) => (e as { status?: number }).status !== 404 && n < 2,
    // Fallback polling while analysis runs, in case the SSE stream is interrupted.
    refetchInterval: (q) => (q.state.data?.status === "running" || q.state.data?.status === "created" ? 3000 : false),
  });
}

export function useInvestigations() {
  return useQuery({ queryKey: qk.investigations, queryFn: api.investigations });
}

export function useTimeline(inv: Investigation | undefined) {
  return useQuery({ queryKey: qk.timeline(inv?.id ?? "none"), queryFn: () => api.timeline(inv!.id), enabled: inv?.status === "completed", staleTime: Infinity });
}

export function useImpact(inv: Investigation | undefined, sha: string | null) {
  return useQuery({ queryKey: qk.impact(inv?.id ?? "none", sha ?? "none"), queryFn: () => api.impact(inv!.id, sha!), enabled: inv?.status === "completed" && !!sha, staleTime: Infinity });
}

export function useHealth(inv: Investigation | undefined) {
  return useQuery({ queryKey: qk.health(inv?.id ?? "none"), queryFn: () => api.health(inv!.id), enabled: inv?.status === "completed", staleTime: Infinity });
}

export function useAIAnalyses(id: string | null) {
  return useQuery({ queryKey: qk.ai(id ?? "none"), queryFn: () => api.aiList(id!), enabled: !!id });
}

export function usePatches(id: string | null) {
  return useQuery({ queryKey: qk.patches(id ?? "none"), queryFn: () => api.patches(id!), enabled: !!id });
}

export function useReports(id?: string) {
  return useQuery({ queryKey: qk.reports(id), queryFn: () => api.reports(id) });
}

export function useAIStatus() {
  return useQuery({ queryKey: qk.aiStatus, queryFn: () => api.aiStatus(false), refetchInterval: 60_000, retry: false });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings });
}

/** Streams progress for a running investigation into the query cache and raises notifications on completion. */
export function useLiveProgress(inv: Investigation | undefined) {
  const qc = useQueryClient();
  const notify = useUI((s) => s.notify);
  const id = inv?.id;
  const running = inv?.status === "running" || inv?.status === "created";
  useEffect(() => {
    if (!id || !running) return;
    const unsub = subscribeProgress(
      id,
      (ev) => {
        if (ev.type === "progress") {
          qc.setQueryData<Investigation>(qk.investigation(id), (old) => (old ? { ...old, progress: ev.progress, status: ev.status } : old));
        } else {
          void qc.invalidateQueries({ queryKey: qk.investigation(id) });
          void qc.invalidateQueries({ queryKey: qk.investigations });
          if (ev.status === "completed") {
            toast.success("Investigation complete", { description: inv?.name });
            notify({ title: "Investigation complete", body: inv?.name, tone: "success", href: `/mission?inv=${id}` });
          } else if (ev.status === "failed") {
            toast.error("Investigation failed", { description: ev.error ?? undefined });
            notify({ title: "Investigation failed", body: ev.error ?? undefined, tone: "error", href: `/portal?inv=${id}` });
          }
        }
      },
      () => void qc.invalidateQueries({ queryKey: qk.investigation(id) }),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, running]);
}
