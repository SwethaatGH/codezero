export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="10" fill="none" stroke="#8BFFB0" strokeWidth="2" opacity="0.9" />
        <circle cx="16" cy="16" r="14" fill="none" stroke="#40E0D0" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
        <circle cx="16" cy="16" r="3.4" fill="#FF5C7A" className="animate-pulse-ring origin-center" />
        <path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="#40E0D0" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[15px] font-bold tracking-[0.14em] text-ink">
            CODE <span className="text-gradient">ZERO</span>
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-3">Patient Zero Lab</div>
        </div>
      )}
    </div>
  );
}
