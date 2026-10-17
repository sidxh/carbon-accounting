import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/**
 * The mark: a ring of three arrows (the yearly cycle of asking and reporting), a
 * plant growing inside it with a rising line cut through its leaves, and a document
 * where the cycle closes. Drawn in one colour (`currentColor`) on a 64 grid; the
 * line's halo and the leaf veins are cut with a mask, so it sits on any background.
 */
export function LogoGlyph({ className }: { className?: string }) {
  // Several marks can share a page (nav, footer), so each needs its own mask id.
  const mask = `logo-cut-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <defs>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" fill="#fff"/>
      <path d="M14 47L24 37L30 41L41.5 28.5" stroke="#000" strokeWidth="6.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M46.6 22.2L43.4 31.4L37.9 26.3Z" stroke="#000" strokeWidth="3.2" strokeLinejoin="round" fill="#000"/>
      <g stroke="#000" strokeWidth="1.1" strokeLinecap="round">
      <path d="M30 37V19.5M30 29l-3.4-3.2M30 29l3.4-3.2M30 24.5l-2.6-2.5M30 24.5l2.6-2.5"/>
      <path d="M26.5 40.5L17 30.5M22 35.6l-.5-3.8M22 35.6l-3.9.3"/>
      <path d="M34.5 42.5L42.6 32.5M38.7 37.6l3.8-.3M38.7 37.6l.1-3.6"/>
      </g>
      </mask>
      </defs>
      <g fill="currentColor" stroke="currentColor">
      {/* the cycle: three arrows round, and the arc that closes it under the document */}
      <g fill="none" strokeWidth="3.2" strokeLinecap="round">
      <path d="M28.52 56.76A25 25 0 0 1 7.03 30.69"/>
      <path d="M8.99 22.23A25 25 0 0 1 28.52 7.24"/>
      <path d="M37.20 7.55A25 25 0 0 1 53.65 19.50"/>
      <path d="M54.07 43.74A25 25 0 0 1 34.61 56.86"/>
      </g>
      <g strokeWidth="1.2" strokeLinejoin="round">
      <path d="M7.29 25.82L2.75 32.09L11.14 32.53Z"/>
      <path d="M33.35 6.56L26.33 3.31L27.50 11.63Z"/>
      <path d="M56.09 23.72L56.48 15.99L49.20 20.19Z"/>
      </g>
      {/* the plant: three leaves on a stem that runs down into the ring */}
      <g mask={`url(#${mask})`} stroke="none">
      <path d="M30 40C21.5 33.5 21.5 22.5 30 14.5C38.5 22.5 38.5 33.5 30 40Z"/>
      <path d="M27.5 42.5C18 43 12.5 36 13.5 27C22 27.5 28 33.5 27.5 42.5Z"/>
      <path d="M33 44.5C33.5 36 38.5 30.5 46 29C47 37.5 41.5 43.5 33 44.5Z"/>
      <path d="M28.6 39.5C29 46 30.2 51.5 33.6 56.6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      </g>
      {/* the rising line with its arrowhead */}
      <path d="M14 47L24 37L30 41L41.5 28.5" fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M46.6 22.2L43.4 31.4L37.9 26.3Z" strokeWidth="1" strokeLinejoin="round"/>
      {/* the document, at the end of the cycle */}
      <g fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M53.3 29.2V40.3H61.3V31.6"/>
      <path d="M50.8 26.7H57.6L59.8 28.9V38.3H50.8Z" fill="#fff"/>
      <path d="M55.3 28.6V32.2M53.9 30.9L55.3 32.3L56.7 30.9M52.8 34.3H57.8M52.8 36.3H57.8" strokeWidth="1"/>
      </g>
      </g>
    </svg>
  );
}

/** The mark at a size, in the brand green. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center text-signal", className)} style={{ width: size, height: size }}>
      <LogoGlyph className="size-full" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  const t = useTranslations();
  // The name's second part is set in green bold: "Net" + "Zero" for a joined name
  // (split at its second capital), or the words after the first for a spaced one.
  const name = t("app.name");
  const joined = name.match(/^(\S+?)([A-Z]\S*)$/);
  const [first, rest, gap] = joined ? [joined[1], joined[2], ""] : [name.split(" ")[0], name.split(" ").slice(1).join(" "), " "];
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)} aria-label={name}>
      <LogoMark />
      <span className="font-display text-xl tracking-tight" aria-hidden>
        {first}
        {rest && <>{gap}<strong className="font-semibold text-signal-ink">{rest}</strong></>}
      </span>
    </span>
  );
}
