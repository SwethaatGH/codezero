import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Bell, Brain, ChevronDown, GitBranch, Menu, Search, Settings, X } from "lucide-react";
import type { Investigation } from "@code-zero/shared";
import { useAIStatus, useInvestigations } from "../../lib/queries";
import { useSelection } from "../../lib/selection";
import { useUI } from "../../lib/store";
import { cn, relTime } from "../../lib/utils";
import { Badge, Button, Kbd, StatusDot } from "../ui";
import { NAV } from "./nav";
import { Logo } from "./Logo";

const STATUS: Record<Investigation["status"], { tone: "healthy" | "warn" | "crit" | "unknown" | "cyan"; label: string }> = {
  created: { tone: "unknown", label: "Not started" },
  running: { tone: "cyan", label: "Analyzing" },
  completed: { tone: "healthy", label: "Analysis complete" },
  failed: { tone: "crit", label: "Failed" },
  cancelled: { tone: "warn", label: "Cancelled" },
};

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

export function Header({ inv }: { inv: Investigation | undefined }) {
  const { setInvestigation } = useSelection();
  const navigate = useNavigate();
  const ai = useAIStatus();
  const invs = useInvestigations();
  const { notifications, markAllRead, clearNotifications, setCommandOpen } = useUI();
  const unread = notifications.filter((n) => !n.read).length;
  const [openInv, setOpenInv] = useState(false);
  const [openBell, setOpenBell] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const invRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  useOutside(invRef, () => setOpenInv(false));
  useOutside(bellRef, () => setOpenBell(false));

  const aiTone = ai.isLoading ? "unknown" : ai.data?.state === "connected" ? "healthy" : ai.data?.state === "model-missing" || ai.data?.state === "error" ? "warn" : "crit";
  const aiLabel = ai.isLoading ? "Checking…" : ai.data?.state === "connected" ? "Gemma online" : ai.data?.state === "model-missing" ? "Model missing" : ai.data?.state === "error" ? "Gemma error" : "Gemma offline";

  return (
    <header className="no-print relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-lab/70 px-3 backdrop-blur md:px-5">
      <Button size="icon" variant="ghost" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
        <Menu className="h-4 w-4" />
      </Button>
      <div className="md:hidden">
        <Logo compact />
      </div>

      {/* Patient (repository) / investigation switcher */}
      <div ref={invRef} className="relative min-w-0">
        <button onClick={() => setOpenInv((v) => !v)} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]" aria-haspopup="listbox" aria-expanded={openInv}>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3 sm:inline">Patient</span>
          <span className="max-w-[130px] truncate font-display text-sm font-semibold text-ink sm:max-w-none">{inv?.repoFullName ?? "No repository"}</span>
          {inv?.isDemo && <Badge tone="warn" className="hidden sm:inline-flex">SIMULATED</Badge>}
          <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
        </button>
        {openInv && (
          <div className="glass absolute left-0 top-full mt-1 w-[360px] rounded-xl p-1.5 shadow-2xl" role="listbox">
            <div className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Recent investigations</div>
            <div className="max-h-72 overflow-y-auto">
              {(invs.data ?? []).slice(0, 12).map((i) => (
                <button
                  key={i.id}
                  role="option"
                  aria-selected={i.id === inv?.id}
                  onClick={() => {
                    setInvestigation(i.id);
                    setOpenInv(false);
                  }}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]", i.id === inv?.id && "bg-cyan/[0.07]")}
                >
                  <StatusDot tone={STATUS[i.status].tone} pulse={i.status === "running"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{i.name}</div>
                    <div className="truncate text-xs text-ink-3">
                      {i.repoFullName} · {relTime(i.updatedAt)}
                    </div>
                  </div>
                </button>
              ))}
              {invs.data?.length === 0 && <div className="px-2 py-3 text-sm text-ink-2">No investigations yet.</div>}
            </div>
            <div className="mt-1 border-t border-line pt-1">
              <button onClick={() => { setOpenInv(false); navigate("/portal"); }} className="w-full rounded-lg px-2 py-2 text-left text-sm text-cyan hover:bg-white/[0.04]">
                + New investigation
              </button>
            </div>
          </div>
        )}
      </div>

      {inv && (
        <button
          onClick={() => navigate(`/portal?repo=${encodeURIComponent(inv.repositoryId)}&branch=${encodeURIComponent(inv.branch)}`)}
          title="Branch under investigation — click to investigate another branch"
          className="hidden items-center gap-1.5 rounded-lg border border-line-2 px-2 py-1 font-mono text-xs text-ink-2 hover:text-ink lg:flex"
        >
          <GitBranch className="h-3.5 w-3.5" /> {inv.branch}
          <ChevronDown className="h-3 w-3 text-ink-3" />
        </button>
      )}
      {inv && (
        <span className="hidden items-center gap-1.5 text-xs text-ink-2 lg:flex" aria-live="polite">
          <StatusDot tone={STATUS[inv.status].tone} pulse={inv.status === "running"} />
          {STATUS[inv.status].label}
          {inv.status === "running" && <span className="font-mono text-cyan">{inv.progress.percent}%</span>}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={() => setCommandOpen(true)} className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-line-2 bg-obsidian/60 px-2.5 text-xs text-ink-3 hover:border-cyan/40 sm:flex" aria-label="Search and commands">
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 truncate whitespace-nowrap text-left">Search commits, files…</span>
          <Kbd>⌘K</Kbd>
        </button>
        <Button size="icon" variant="ghost" className="sm:hidden" onClick={() => setCommandOpen(true)} aria-label="Search">
          <Search className="h-4 w-4" />
        </Button>

        <Link to="/settings" title={ai.data?.message ?? "Gemma connection status"} className="hidden items-center gap-1.5 rounded-lg border border-line-2 px-2 py-1 text-xs text-ink-2 hover:text-ink sm:flex">
          <Brain className="h-3.5 w-3.5" />
          <StatusDot tone={aiTone} pulse={ai.data?.state === "connected"} />
          {aiLabel}
        </Link>

        <div ref={bellRef} className="relative">
          <Button size="icon" variant="ghost" aria-label={`Notifications (${unread} unread)`} onClick={() => { setOpenBell((v) => !v); if (!openBell) markAllRead(); }}>
            <Bell className="h-4 w-4" />
            {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-crit" />}
          </Button>
          {openBell && (
            <div className="glass absolute right-0 top-full mt-1 w-80 rounded-xl p-1.5 shadow-2xl">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Notifications</span>
                {notifications.length > 0 && <button onClick={clearNotifications} className="text-xs text-ink-3 hover:text-ink">Clear</button>}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 && <div className="px-2 py-4 text-center text-sm text-ink-3">No notifications</div>}
                {notifications.map((n) => (
                  <button key={n.id} onClick={() => { if (n.href) navigate(n.href); setOpenBell(false); }} className="flex w-full gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]">
                    <StatusDot tone={n.tone === "success" ? "healthy" : n.tone === "error" ? "crit" : n.tone === "warn" ? "warn" : "cyan"} />
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{n.title}</div>
                      {n.body && <div className="truncate text-xs text-ink-2">{n.body}</div>}
                      <div className="text-[10px] text-ink-3">{relTime(n.at)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" aria-label="Settings" onClick={() => navigate("/settings")}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {mobileNav && (
        <div className="fixed inset-0 z-50 bg-obsidian/80 backdrop-blur md:hidden" onClick={() => setMobileNav(false)}>
          <nav className="h-full w-72 overflow-y-auto border-r border-line bg-lab p-3" onClick={(e) => e.stopPropagation()} aria-label="Mobile navigation">
            <div className="mb-3 flex items-center justify-between">
              <Logo />
              <Button size="icon" variant="ghost" aria-label="Close navigation" onClick={() => setMobileNav(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {NAV.map((s) => (
              <div key={s.section} className="mb-3">
                <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-3">{s.section}</div>
                {s.items.map((i) => (
                  <NavLink key={i.path} to={`${i.path}${inv ? `?inv=${inv.id}` : ""}`} onClick={() => setMobileNav(false)} className={({ isActive }) => cn("flex items-center gap-2 rounded-lg px-2 py-2 text-sm", isActive ? "bg-cyan/10 text-ink" : "text-ink-2")}>
                    <i.icon className="h-4 w-4" /> {i.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
