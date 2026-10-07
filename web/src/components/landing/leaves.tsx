import { cn } from "@/lib/cn";

// Long, faint leaves behind the whole landing page, growing in from alternating
// edges all the way down, plus the pale green wash that sits behind "How it works".

/** A long lanceolate leaf in a len×w box, base at the bottom centre, with a midrib. */
function Leaf({ len, w }: { len: number; w: number }) {
  const c = w / 2;
  return (
    <svg width={w} height={len} viewBox={`0 0 ${w} ${len}`} className="block overflow-visible">
      <path
        d={`M${c} ${len}C${c + w * 0.75} ${len * 0.78} ${c + w * 0.55} ${len * 0.28} ${c} 0C${c - w * 0.55} ${len * 0.28} ${c - w * 0.75} ${len * 0.78} ${c} ${len}Z`}
        fill="var(--signal)"
      />
      <path d={`M${c} ${len}Q${c + w * 0.04} ${len * 0.5} ${c} ${len * 0.04}`} fill="none" stroke="var(--signal-ink)" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

// top: % down the page; edge: which side it grows from; off: px pushed past that edge;
// rot: tilt in degrees (0 = pointing straight up); o: opacity.
type Spec = { top: number; edge: "left" | "right"; off: number; len: number; w: number; rot: number; o: number };

const SPECS: Spec[] = [
  { top: 4, edge: "right", off: -120, len: 520, w: 115, rot: -140, o: 0.09 },
  { top: 9, edge: "right", off: -60, len: 400, w: 90, rot: -115, o: 0.07 },
  { top: 14, edge: "left", off: -110, len: 560, w: 120, rot: 40, o: 0.09 },
  { top: 22, edge: "left", off: -40, len: 420, w: 95, rot: 62, o: 0.07 },
  { top: 30, edge: "right", off: -130, len: 600, w: 130, rot: -48, o: 0.1 },
  { top: 37, edge: "right", off: -60, len: 440, w: 95, rot: -70, o: 0.08 },
  { top: 45, edge: "left", off: -120, len: 620, w: 135, rot: 30, o: 0.12 },
  { top: 50, edge: "left", off: -50, len: 460, w: 100, rot: 55, o: 0.1 },
  { top: 56, edge: "right", off: -100, len: 560, w: 120, rot: -150, o: 0.11 },
  { top: 62, edge: "right", off: -40, len: 400, w: 90, rot: -125, o: 0.09 },
  { top: 70, edge: "left", off: -110, len: 540, w: 115, rot: 140, o: 0.09 },
  { top: 78, edge: "right", off: -120, len: 580, w: 125, rot: -40, o: 0.09 },
  { top: 85, edge: "left", off: -90, len: 500, w: 110, rot: 48, o: 0.08 },
  { top: 93, edge: "right", off: -70, len: 440, w: 95, rot: -60, o: 0.08 },
];

/** Page-wide leaf layer. Place it first inside a `relative` page root, under the content. */
export function LeafField({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {SPECS.map((l, i) => (
        <div
          key={i}
          className="absolute"
          style={{ top: `${l.top}%`, [l.edge]: l.off, opacity: l.o, transform: `rotate(${l.rot}deg)`, transformOrigin: "50% 100%" }}
        >
          <Leaf len={l.len} w={l.w} />
        </div>
      ))}
    </div>
  );
}

/** The pale green wash behind "How it works", fading from and back to paper. */
export function GreenWash({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgb(230_243_240/0.6)_22%,rgb(230_243_240/0.6)_70%,transparent)]", className)}
    />
  );
}
