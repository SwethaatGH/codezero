import { NavLink, useSearchParams } from "react-router-dom";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useUI } from "../../lib/store";
import { cn } from "../../lib/utils";
import { NAV } from "./nav";
import { Logo } from "./Logo";

export function Sidebar() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const toggle = useUI((s) => s.toggleSidebar);
  const [params] = useSearchParams();
  const inv = params.get("inv") ?? useUI.getState().lastInvestigationId;
  const qs = (path: string) => {
    const next = new URLSearchParams();
    if (inv) next.set("inv", inv);
    for (const k of ["commit", "a", "b"]) if (params.get(k)) next.set(k, params.get(k)!);
    const s = next.toString();
    return s ? `${path}?${s}` : path;
  };

  return (
    <aside className={cn("no-print hidden shrink-0 flex-col border-r border-line bg-lab/80 backdrop-blur md:flex", collapsed ? "w-[64px]" : "w-[236px]")} aria-label="Primary">
      <div className={cn("flex h-14 items-center border-b border-line", collapsed ? "justify-center" : "px-4")}>
        <Logo compact={collapsed} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((sec) => (
          <div key={sec.section} className="mb-4">
            {!collapsed && <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-3">{sec.section}</div>}
            <ul className="space-y-0.5">
              {sec.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={qs(item.path)}
                    title={collapsed ? `${item.label} — ${item.tech}` : item.tech}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                        collapsed && "justify-center px-0",
                        isActive ? "bg-cyan/[0.08] text-ink" : "text-ink-2 hover:bg-white/[0.03] hover:text-ink",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-bio shadow-[0_0_10px_rgba(139,255,176,0.8)]" />}
                        <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-bio" : "text-ink-3 group-hover:text-cyan")} />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <button onClick={toggle} className="flex h-10 items-center justify-center gap-2 border-t border-line text-xs text-ink-3 hover:text-ink" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : (<><ChevronsLeft className="h-4 w-4" /> Collapse</>)}
      </button>
    </aside>
  );
}
