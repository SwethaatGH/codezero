import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, Check, Copy, Inbox, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import type { FindingStatus } from "@code-zero/shared";
import { FINDING_STATUS_LABELS } from "@code-zero/shared";
import { cn, scoreColor, scoreLevel, short } from "../../lib/utils";
import { useMotionOff } from "../../lib/store";

// ─── Button ──────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-bio text-obsidian hover:bg-[#a6ffc3] font-semibold shadow-[0_0_20px_-6px_rgba(139,255,176,0.6)]",
  secondary: "bg-panel-2 text-ink border border-line-2 hover:border-cyan/50 hover:bg-[#183041]",
  outline: "border border-cyan/40 text-cyan hover:bg-cyan/10",
  ghost: "text-ink-2 hover:text-ink hover:bg-white/5",
  danger: "bg-crit/15 text-crit border border-crit/40 hover:bg-crit/25",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-sm",
        size === "icon" && "h-8 w-8",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ─── Panel ───────────────────────────────────────────────────────────

export function Panel({ className, children, glow, ...rest }: { className?: string; children: ReactNode; glow?: "bio" | "crit" | "cyan" } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cn("glass rounded-xl", glow && `glow-${glow}`, className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, subtitle, icon, actions, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-cyan">{icon}</span>}
        <div className="min-w-0">
          <h3 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

/** Page title pairing the themed label with its plain technical meaning. */
export function PageTitle({ themed, technical, description, actions }: { themed: string; technical: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-teal">{technical}</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink md:text-[28px]">{themed}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── Badges ──────────────────────────────────────────────────────────

type Tone = "healthy" | "warn" | "crit" | "unknown" | "cyan" | "bio" | "neutral";
const TONES: Record<Tone, string> = {
  healthy: "bg-healthy/12 text-healthy border-healthy/30",
  warn: "bg-warn/12 text-warn border-warn/30",
  crit: "bg-crit/12 text-crit border-crit/35",
  unknown: "bg-unknown/12 text-unknown border-unknown/30",
  cyan: "bg-cyan/10 text-cyan border-cyan/30",
  bio: "bg-bio/10 text-bio border-bio/30",
  neutral: "bg-white/5 text-ink-2 border-line-2",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const color = { healthy: "bg-healthy", warn: "bg-warn", crit: "bg-crit", unknown: "bg-unknown", cyan: "bg-cyan", bio: "bg-bio", neutral: "bg-ink-3" }[tone];
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const lvl = scoreLevel(score);
  const tone: Tone = lvl === "high" ? "crit" : lvl === "elevated" ? "warn" : lvl === "moderate" ? "cyan" : "healthy";
  return (
    <Badge tone={tone} className={cn("font-mono", className)} title="Heuristic risk score (0–100). Not a probability of failure.">
      {score}
      <span className="opacity-70">/100</span>
    </Badge>
  );
}

const STATUS_TONE: Record<FindingStatus, Tone> = { "test-confirmed": "crit", suspected: "warn", "unverified-hypothesis": "cyan", "insufficient-evidence": "unknown" };
export function FindingBadge({ status }: { status: FindingStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{FINDING_STATUS_LABELS[status]}</Badge>;
}

export function DetectionBadge({ detection }: { detection: "ast" | "heuristic" | "metadata" }) {
  const map = {
    ast: { tone: "cyan" as Tone, label: "AST", tip: "Derived from the TypeScript compiler AST" },
    heuristic: { tone: "warn" as Tone, label: "Heuristic", tip: "Pattern-based detection; may produce false positives" },
    metadata: { tone: "neutral" as Tone, label: "Metadata", tip: "Derived from commit/file metadata" },
  }[detection];
  return (
    <Badge tone={map.tone} title={map.tip}>
      {map.label}
    </Badge>
  );
}

export function ScoreRing({ score, size = 64, label }: { score: number | null; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = score ?? 0;
  const color = score === null ? "#8C9BA8" : scoreColor(v);
  const off = useMotionOff();
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"}: ${score ?? "unknown"} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1d3343" strokeWidth={5} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: off ? c - (v / 100) * c : c }}
          animate={{ strokeDashoffset: c - (v / 100) * c }}
          transition={{ duration: off ? 0 : 1, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <span className="absolute font-mono text-sm font-semibold" style={{ color }}>
        {score ?? "—"}
      </span>
    </div>
  );
}

// ─── Inputs ──────────────────────────────────────────────────────────

const field = "w-full rounded-lg border border-line-2 bg-obsidian/70 px-3 text-sm text-ink placeholder:text-ink-3 focus:border-cyan/60 focus:outline-none focus:ring-2 focus:ring-cyan/20 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(field, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(field, "py-2", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%239FB4BE%22 stroke-width=%222%22><path d=%22M3 4.5l3 3 3-3%22/></svg>')] bg-[right_10px_center] bg-no-repeat pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-crit">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto rounded-lg border border-line bg-obsidian/50 p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors", value === t.id ? "bg-panel-2 text-ink shadow-[inset_0_0_0_1px_rgba(64,224,208,0.35)]" : "text-ink-2 hover:text-ink")}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded bg-white/5 px-1 font-mono text-[10px] text-ink-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Chips ───────────────────────────────────────────────────────────

export function Chip({ active, onClick, children, onRemove }: { active?: boolean; onClick?: () => void; children: ReactNode; onRemove?: () => void }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors", active ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-line-2 text-ink-2 hover:text-ink")}>
      <button type="button" onClick={onClick} className="outline-none">
        {children}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove filter" className="text-ink-3 hover:text-ink">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-describedby={open ? id : undefined}>
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 w-max max-w-xs rounded-md border border-line-2 bg-[#0c1a24] px-2.5 py-1.5 text-xs text-ink shadow-xl",
            side === "top" && "bottom-full left-1/2 mb-2 -translate-x-1/2",
            side === "bottom" && "left-1/2 top-full mt-2 -translate-x-1/2",
            side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// ─── States ──────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-white/[0.04]", className)}>
      <div className="absolute inset-0 animate-scan bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full border border-line-2 bg-panel-2 text-ink-2">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border border-crit/30 bg-crit/[0.06] p-4", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crit" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-crit">Something went wrong</p>
        <p className="mt-0.5 break-words text-sm text-ink-2">{msg}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ─── Misc ────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-obsidian px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{children}</kbd>;
}

export function Sha({ sha, className }: { sha: string | null | undefined; className?: string }) {
  return <code className={cn("rounded bg-cyan/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-cyan", className)}>{short(sha)}</code>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      icon={done ? <Check className="h-3.5 w-3.5 text-healthy" /> : <Copy className="h-3.5 w-3.5" />}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; icon?: ReactNode }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-ink-2">
        <span>{label}</span>
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </Panel>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,button,textarea,select")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-obsidian/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cn("glass w-full rounded-xl", wide ? "max-w-3xl" : "max-w-md")}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-sm font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", danger, onConfirm, onCancel, loading }: { open: boolean; title: string; description: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="text-sm text-ink-2">{description}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function SimulatedBanner({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn", className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>SIMULATED DEMO DATA.</strong> This investigation uses the built-in <span className="font-mono">orbit-checkout</span> repository with a deliberately introduced regression.
      </span>
    </div>
  );
}
