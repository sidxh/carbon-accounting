import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/**
 * The mark: a bill whose folded corner is a leaf, with a trace line running
 * out of it to a point. Document, then number: the product in one glyph.
 * Drawn on a 24 grid with round joins so it holds at 16 px.
 */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M13 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V10" />
      <path d="M14.2 8.8C14 5.2 16.4 2.6 21 2.4c-.2 4.6-2.8 7-6.8 6.4Z" fill="currentColor" stroke="none" />
      <path d="M9 11.5h4.5M9 14.5h3" strokeOpacity={0.7} />
      <path d="M9 17.5h11" />
      <circle cx={20.6} cy={17.5} r={1.3} fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-[10px] bg-signal text-signal-on", className)} style={{ width: size, height: size }}>
      <LogoGlyph className="size-[70%]" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  const t = useTranslations();
  const [first, ...rest] = t("app.name").split(" ");
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)} aria-label={t("app.name")}>
      <LogoMark />
      <span className="font-display text-xl tracking-tight" aria-hidden>
        {first}
        {rest.length > 0 && <> <em className="italic text-signal-ink">{rest.join(" ")}</em></>}
      </span>
    </span>
  );
}
