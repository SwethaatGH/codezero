import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useInvestigation, useLiveProgress } from "../../lib/queries";
import { useSelection } from "../../lib/selection";
import { useMotionOff, useUI } from "../../lib/store";
import { cn } from "../../lib/utils";
import { CommandPalette } from "./CommandPalette";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ALL_NAV } from "./nav";

/** "g" then a digit jumps to a module (vim-style), ignoring typing in inputs. */
function useGoShortcuts() {
  const { go } = useSelection();
  const pending = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest(".monaco-editor")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "g") {
        pending.current = true;
        setTimeout(() => (pending.current = false), 900);
        return;
      }
      if (pending.current) {
        const target = ALL_NAV.find((n) => n.key === e.key);
        if (target) go(target.path);
        pending.current = false;
      }
      if (e.key === "?" ) go("/docs");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
}

export function AppShell() {
  const { invId } = useSelection();
  const inv = useInvestigation(invId);
  useLiveProgress(inv.data);
  useGoShortcuts();
  const location = useLocation();
  const motionOff = useMotionOff();
  const reduced = useUI((s) => s.reducedMotion);

  return (
    <div className={cn("lab-grid flex h-full", reduced && "reduce-motion")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-bio focus:px-3 focus:py-2 focus:text-obsidian">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header inv={inv.data} />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={motionOff ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={motionOff ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="mx-auto h-full w-full max-w-[1600px] p-4 md:p-6"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
