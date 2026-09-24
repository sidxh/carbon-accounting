"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { cn as clsx } from "@/lib/cn";

/** Page heading: serif display line with a one-sentence lede. */
export function PageTitle({ eyebrow, title, lede, aside }: { eyebrow?: string; title: string; lede?: string; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="font-display text-[2rem] leading-[1.05] text-balance text-ink sm:text-[2.5rem]">{title}</h1>
        {lede && <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted">{lede}</p>}
      </div>
      {aside}
    </div>
  );
}

/**
 * Headline number. `value` is numeric so NumberFlow can roll the digits when a
 * recompute or correction changes it (rare, state indication); static text
 * values render as-is.
 */
export function Stat({ label, value, unit, sub, tone = "default", className, digits = 2 }: { label: string; value: number | string; unit?: string; sub?: React.ReactNode; tone?: "default" | "signal" | "muted"; className?: string; digits?: number }) {
  return (
    <div className={clsx("card p-4 sm:p-5", className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div data-stat data-value={typeof value === "number" ? value.toFixed(digits) : value} className={clsx("mt-1 font-display text-3xl leading-none tabular sm:text-[2.25rem]", tone === "signal" ? "text-signal-ink" : tone === "muted" ? "text-muted" : "text-ink")}>
        {typeof value === "number" ? (
          <NumberFlow value={value} format={{ maximumFractionDigits: digits }} transformTiming={{ duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }} spinTiming={{ duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }} />
        ) : (
          value
        )}
        {unit && <span className="ml-1.5 font-sans text-sm font-normal text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      {Icon && (
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-muted">
          <Icon className="size-5" aria-hidden />
        </div>
      )}
      <div className="font-display text-xl text-balance text-ink">{title}</div>
      {body && <p className="mt-1 max-w-sm text-sm text-pretty text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Shimmer pauses while the placeholder is off-screen. */
export function Skeleton({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={clsx("skeleton", className)} data-offscreen={visible ? undefined : ""} aria-hidden />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

/** Horizontal stacked bar; segments sum to 1. Text labels carry the meaning. */
export function MixBar({ segments, className }: { segments: { key: string; share: number; className: string; label: string }[]; className?: string }) {
  return (
    <div className={clsx("flex h-2 w-full overflow-hidden rounded-full bg-sunken", className)} role="img" aria-label={segments.map((s) => `${s.label} ${(s.share * 100).toFixed(1)}%`).join(", ")}>
      {segments.filter((s) => s.share > 0).map((s) => (
        <span key={s.key} className={s.className} style={{ width: `${s.share * 100}%` }} title={`${s.label} ${(s.share * 100).toFixed(1)}%`} />
      ))}
    </div>
  );
}

/** Twelve month cells. `states[i]` is primary | secondary | estimated | missing | na. */
export function CoverageStrip({ states, months, className }: { states: string[]; months?: string[]; className?: string }) {
  return (
    <div className={clsx("coverage", className)} role="img" aria-label={states.map((s, i) => `${months?.[i] ?? i + 1}: ${s}`).join(", ")}>
      {states.map((s, i) => <span key={i} className={`cov-${s}`} style={{ "--i": i } as React.CSSProperties} title={`${months?.[i] ?? ""} ${s}`.trim()} />)}
    </div>
  );
}

export const TIER_PILL: Record<string, string> = { primary: "pill-primary", secondary: "pill-secondary", estimated: "pill-estimated" };
export const TIER_BAR: Record<string, string> = { primary: "bg-signal", secondary: "bg-tier2", estimated: "bg-attention-strong" };
