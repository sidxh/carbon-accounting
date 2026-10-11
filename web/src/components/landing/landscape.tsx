"use client";

// The shared illustrated landscape and its parts: the landing footer draws it whole;
// the sign-in picture builds its own from the same parts.

// Illustration colours: misty greens from the paper down to the footer's ground.
// They are a picture, not tokens.
export const MIST = ["#dce9e4", "#bcd8cf", "#94c1b4", "#5f9e8f", "#2f7568", "#145a51"];
export const GROUND = "#0d4a43";

/** Seeded pines along a ridge, as one path: each a stack of three triangles on a trunk. */
export function pines(seed: number, from: number, to: number, base: (x: number) => number, count: number, size: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  let d = "";
  for (let i = 0; i < count; i++) {
    const x = from + ((to - from) * (i + rnd() * 0.8)) / count;
    const h = size * (0.7 + rnd() * 0.6);
    const w = h * 0.36;
    const y = base(x) + 4;
    for (let k = 0; k < 3; k++) {
      const top = y - h + k * h * 0.22;
      const bw = w * (0.55 + k * 0.25);
      const by = y - h * (0.42 - k * 0.16);
      d += `M${(x - bw).toFixed(1)} ${by.toFixed(1)}L${x.toFixed(1)} ${top.toFixed(1)}L${(x + bw).toFixed(1)} ${by.toFixed(1)}Z`;
    }
    d += `M${(x - 1.5).toFixed(1)} ${y.toFixed(1)}h3v${(-h * 0.2).toFixed(1)}h-3Z`;
  }
  return d;
}

// The ridgeline the pines stand on (mid hills), as a function for placing them.
const midRidge = (x: number) => 250 - 28 * Math.sin(x / 210) - 16 * Math.sin(x / 77 + 1);

export function Turbine({ x, y, h }: { x: number; y: number; h: number }) {
  return (
    <g>
      <path d={`M${x - 2} ${y}L${x - 0.8} ${y - h}h1.6L${x + 2} ${y}Z`} fill={MIST[4]} />
      <g className="footer-turbine" style={{ transformOrigin: `${x}px ${y - h}px` }}>
        {[0, 120, 240].map((a) => (
          <path key={a} transform={`rotate(${a} ${x} ${y - h})`} d={`M${x} ${y - h}q3 -${h * 0.22} 0 -${h * 0.46}q-3 ${h * 0.22} 0 ${h * 0.46}Z`} fill={MIST[4]} />
        ))}
      </g>
      <circle cx={x} cy={y - h} r={2.2} fill={MIST[5]} />
    </g>
  );
}

/** A farmhouse with a solar roof, standing at (x, y): its bottom-left corner. */
export function Farmhouse({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={-30} width={52} height={30} fill={MIST[5]} />
      <path d="M-6 -28 L26 -50 L58 -28 Z" fill={GROUND} />
      <path d="M28 -36 L50 -36 L56 -30 L34 -30 Z" fill="#9cc7d8" opacity={0.85} />
      <path d="M2 -36 L24 -36 L18 -30 L-4 -30 Z" fill="#9cc7d8" opacity={0.85} />
      <rect x={20} y={-16} width={9} height={16} fill={GROUND} />
    </g>
  );
}

/** The big tree, its trunk standing at (x, y), scaled by `s`. */
export function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={GROUND}>
      <path d="M-16 0 C-18 -38 -10 -56 -4 -76 L4 -76 C6 -52 10 -30 8 0 Z" />
      <path d="M-4 -56 C-20 -66 -34 -68 -48 -64 M4 -66 C20 -78 34 -80 48 -76" stroke={GROUND} strokeWidth={5} fill="none" strokeLinecap="round" />
      <ellipse cx={0} cy={-122} rx={62} ry={44} />
      <ellipse cx={-48} cy={-92} rx={40} ry={26} />
      <ellipse cx={52} cy={-94} rx={42} ry={27} />
      <ellipse cx={2} cy={-158} rx={38} ry={28} />
    </g>
  );
}

/**
 * The landscape: misty ridges and a lake, pines, turbines whose blades turn, a
 * farmhouse with a solar roof and a big tree, settling into deep green ground.
 * `viewBox` crops it for the space it fills (the footer shows the whole width;
 * a tall panel shows the turbines and lake).
 */
export function Landscape({
  className,
  viewBox = "0 60 1440 360",
  preserve = "xMidYMax slice",
}: { className?: string; viewBox?: string; preserve?: string }) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio={preserve} className={className} aria-hidden>
      {/* Far ridges, fading into the paper. */}
      <path d="M0 200 Q160 110 320 160 T640 130 T980 150 T1260 105 T1440 140 V420 H0Z" fill={MIST[0]} />
      <path d="M0 235 Q200 165 380 205 T760 180 T1100 200 T1440 170 V420 H0Z" fill={MIST[1]} />
      {/* The lake in the valley. */}
      <path d="M560 268 Q760 252 980 266 Q780 282 560 268Z" fill="#eef5f2" opacity={0.9} />
      {/* Mid hills with pines along them. */}
      <path d={`M0 ${midRidge(0)} ${Array.from({ length: 49 }, (_, i) => `L${i * 30} ${midRidge(i * 30).toFixed(1)}`).join(" ")} V420 H0Z`} fill={MIST[2]} />
      <path d={pines(7, 20, 620, midRidge, 26, 46)} fill={MIST[3]} />
      <path d={pines(19, 860, 1080, midRidge, 8, 40)} fill={MIST[3]} />
      {/* Near hill, rising to the right, with turbines, the farmhouse and the tree. */}
      <path d="M0 330 Q240 300 520 318 T980 300 Q1180 250 1300 240 Q1380 236 1440 244 V420 H0Z" fill={MIST[4]} />
      <Turbine x={620} y={316} h={86} />
      <Turbine x={706} y={312} h={70} />
      <Turbine x={786} y={308} h={58} />
      <Farmhouse x={950} y={298} />
      <Tree x={1160} y={262} />
      {/* Ground, running into the footer. */}
      <path d="M0 372 Q360 350 720 362 T1440 352 V420 H0Z" fill={GROUND} />
    </svg>
  );
}

