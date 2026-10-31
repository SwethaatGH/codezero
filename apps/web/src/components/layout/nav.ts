import type { LucideIcon } from "lucide-react";
import { Activity, BookOpen, Bookmark, Brain, FileText, FlaskConical, GitCompare, Gauge, HeartPulse, Network, Radar, Settings, Siren, Waypoints } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  tech: string;
  icon: LucideIcon;
  key?: string;
}

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { path: "/mission", label: "Mission Control", tech: "Repository overview", icon: Gauge, key: "1" },
      { path: "/portal", label: "Time Portal", tech: "Import & configure", icon: Radar, key: "2" },
    ],
  },
  {
    section: "Diagnostics",
    items: [
      { path: "/timeline", label: "Temporal Timeline", tech: "Commit history", icon: Waypoints, key: "3" },
      { path: "/breakage", label: "Breakage Detector", tech: "Regression ranking", icon: Siren, key: "4" },
      { path: "/divergence", label: "Timeline Divergence", tech: "Code comparison", icon: GitCompare, key: "5" },
      { path: "/infection", label: "Infection Map", tech: "Dependency impact graph", icon: Network, key: "6" },
      { path: "/gemma", label: "Gemma Intelligence", tech: "AI investigation", icon: Brain, key: "7" },
    ],
  },
  {
    section: "Treatment",
    items: [
      { path: "/restore", label: "Restore Lab", tech: "Proposed fixes", icon: FlaskConical, key: "8" },
      { path: "/reports", label: "Investigation Reports", tech: "Medical records", icon: FileText, key: "9" },
    ],
  },
  {
    section: "Monitoring",
    items: [
      { path: "/health", label: "Repository Health", tech: "Health monitor", icon: HeartPulse },
      { path: "/saved", label: "Saved Investigations", tech: "Case files", icon: Bookmark },
    ],
  },
  {
    section: "System",
    items: [
      { path: "/settings", label: "Settings", tech: "Configuration", icon: Settings },
      { path: "/docs", label: "Documentation", tech: "How it works", icon: BookOpen },
    ],
  },
];

export const ALL_NAV = NAV.flatMap((s) => s.items);
export { Activity };
