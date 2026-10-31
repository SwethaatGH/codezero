import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExplanationLevel } from "@code-zero/shared";

export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  tone: "info" | "success" | "warn" | "error";
  at: string;
  read: boolean;
  href?: string;
}

interface UIState {
  sidebarCollapsed: boolean;
  reducedMotion: boolean;
  animations: boolean;
  level: ExplanationLevel;
  lastInvestigationId: string | null;
  commandOpen: boolean;
  notifications: AppNotification[];
  toggleSidebar: () => void;
  setReducedMotion: (v: boolean) => void;
  setAnimations: (v: boolean) => void;
  setLevel: (l: ExplanationLevel) => void;
  setLastInvestigation: (id: string | null) => void;
  setCommandOpen: (v: boolean) => void;
  notify: (n: Omit<AppNotification, "id" | "at" | "read">) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      reducedMotion: false,
      animations: true,
      level: "developer",
      lastInvestigationId: null,
      commandOpen: false,
      notifications: [],
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setAnimations: (animations) => set({ animations }),
      setLevel: (level) => set({ level }),
      setLastInvestigation: (lastInvestigationId) => set({ lastInvestigationId }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      notify: (n) =>
        set((s) => ({ notifications: [{ ...n, id: crypto.randomUUID(), at: new Date().toISOString(), read: false }, ...s.notifications].slice(0, 50) })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      clearNotifications: () => set({ notifications: [] }),
    }),
    {
      name: "code-zero-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, reducedMotion: s.reducedMotion, animations: s.animations, level: s.level, lastInvestigationId: s.lastInvestigationId, notifications: s.notifications }),
    },
  ),
);

/** Whether motion should be minimized (OS preference or in-app setting). */
export function useMotionOff(): boolean {
  const { reducedMotion, animations } = useUI();
  const os = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return reducedMotion || !animations || !!os;
}
