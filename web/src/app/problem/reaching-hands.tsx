import { useId } from "react";

// The problem page's picture: a human hand reaching down and a hand made of
// leaves reaching up, fingertips almost touching. Built from a palm, a thumb and
// four separate fingers (index pointing, the others relaxed), lit softly and
// printed with a fine grain so it sits in the page like the rest of the site's
// illustrations. Still.

// The hand, pointing down: wrist at the top, index fingertip at about (190, 456).
const FOREARM = "M160 -20 L246 -20 C244 60 240 120 238 178 L168 178 C166 120 164 60 160 -20 Z";
const PALM = "M168 168 L238 168 C250 208 258 248 258 288 C258 304 250 312 240 312 L176 312 C164 312 158 300 159 284 C160 248 162 204 168 168 Z";
const THUMB = "M172 206 C160 232 151 260 147 290 C144 310 146 326 152 333 C158 339 167 331 169 318 C173 296 179 270 188 250 Z";
const INDEX = "M174 294 C174 350 176 400 180 440 C181 452 187 459 193 456 C199 453 200 444 199 436 C197 400 196 350 197 298 Z";
const MIDDLE = "M198 302 C198 340 202 372 212 390 C218 401 229 399 231 388 C233 377 227 360 223 336 L221 302 Z";
const RING = "M220 300 C222 334 226 356 236 368 C242 376 252 372 252 362 C252 350 247 330 243 300 Z";
const PINKY = "M240 290 C244 316 248 334 256 342 C262 348 269 343 267 334 C264 318 261 302 257 286 Z";
// Back to front, so the fingers sit over the palm and the thumb over its edge.
const PARTS = [FOREARM, PINKY, RING, MIDDLE, PALM, INDEX, THUMB];

// Small marks that make it read as skin: knuckle creases and the index nail.
const CREASES = ["M178 392 C183 395 192 395 197 392", "M176 350 C182 353 191 353 196 350", "M204 352 C209 356 217 356 222 352", "M226 340 C230 343 237 343 241 340", "M186 252 C192 262 196 276 197 292"];
const NAIL = "M183 440 C183 449 187 454 191 454 C196 454 198 449 197 440 C193 437 187 437 183 440 Z";

const SKIN = "#dcb497";
const SKIN_EDGE = "#b88c6e";
const LEAVES = ["#2f6b4f", "#3f7d5a", "#5d9468", "#7fae73", "#a8c98a", "#1f5640", "#4f8a62"];
const LEAF_PATH = "M0 -9 C5 -5 5 4 0 9 C-5 4 -5 -5 0 -9 Z";

/** Deterministic scatter, so the picture is the same on every render. */
function scatter(seed: number, n: number, x0: number, x1: number, y0: number, y1: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ x: x0 + (x1 - x0) * rnd(), y: y0 + (y1 - y0) * rnd(), r: rnd() * 360, k: 0.55 + rnd() * 0.7, c: Math.floor(rnd() * LEAVES.length) }));
}

// Where the hands sit in the picture (900 wide, 560 tall). The human hand comes in
// from the top, slanting down to the left; the hand of leaves (the same hand,
// mirrored) rises in from the lower left, its wrist inside the frame. Their index
// fingertips meet near (380, 373). Each is the hand above, moved so its fingertip
// (190, 456) lands there, turned, and drawn a fifth larger.
const HUMAN_T = "translate(390 360) rotate(28) scale(1.2) translate(-190 -456)";
const LEAFY_T = "translate(370 386) rotate(-112) scale(-1.2 1.2) translate(-190 -456)";

/**
 * The outline the page's text wraps around (CSS `shape-outside`, as percentages of
 * the picture's box). Beside the arm it runs almost straight, just clear of the
 * arm's widest point, so the headline's lines step in only gently; round the
 * fingertips it curves in, then runs down past the leafy hand. Kept beside the transforms above so
 * the two move together.
 */
export const HANDS_SHAPE =
  "polygon(0% 0%, 75% 0%, 73% 12%, 68% 50%, 62% 60%, 54% 68%, 50% 75%, 40% 80%, 36% 88%, 20% 96%, 8% 100%, 0% 100%)";

// Leaves fill the hand, scattered in its own coordinates.
const LEAFY = scatter(7, 1100, 120, 290, -40, 470);
// A few loose leaves drifting in the gap, in picture coordinates.
const DRIFT = [
  { x: 398, y: 398, r: 40, k: 1, c: 4 },
  { x: 352, y: 364, r: -30, k: 0.85, c: 3 },
  { x: 408, y: 368, r: 80, k: 0.7, c: 2 },
  { x: 342, y: 412, r: -60, k: 0.8, c: 1 },
  { x: 424, y: 418, r: 10, k: 0.65, c: 6 },
];

export function ReachingHands({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const shape = `${id}-shape`, light = `${id}-light`, grain = `${id}-grain`, rough = `${id}-rough`;
  return (
    <svg viewBox="0 0 900 560" preserveAspectRatio="xMinYMin slice" className={className} role="img" aria-label="A human hand reaching down from above towards a hand made of leaves reaching in from the side, their fingertips almost touching.">
      <defs>
        {/* The hand's outline, in its own coordinates; each hand clips to it inside its own transform. */}
        <clipPath id={shape}>{PARTS.map((d) => <path key={d} d={d} />)}</clipPath>
        {/* Light from the upper left, falling off to the right. */}
        <linearGradient id={light} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#fff4e8" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff4e8" stopOpacity="0" />
          <stop offset="1" stopColor="#5a3a26" stopOpacity="0.3" />
        </linearGradient>
        {/* Grain, multiplied onto the shapes only: a coarse layer and a fine one. */}
        <filter id={grain} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="noise" />
          <feColorMatrix in="noise" type="saturate" values="0" result="grey" />
          <feComponentTransfer in="grey" result="faint"><feFuncA type="table" tableValues="0 0.55" /></feComponentTransfer>
          <feComposite in="faint" in2="SourceGraphic" operator="in" result="speckle" />
          <feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="1" seed="9" result="fine" />
          <feColorMatrix in="fine" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3 0 0 0 -2.05" result="light" />
          <feComposite in="light" in2="SourceGraphic" operator="in" result="sparkle" />
          <feBlend in="SourceGraphic" in2="speckle" mode="multiply" result="printed" />
          <feMerge><feMergeNode in="printed" /><feMergeNode in="sparkle" /></feMerge>
        </filter>
        {/* Roughens the leafy hand's outline so leaves break its edge. */}
        <filter id={rough} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="12" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      {/* The human hand, from above. */}
      <g filter={`url(#${grain})`}>
        <g transform={HUMAN_T}>
          <g fill={SKIN} stroke={SKIN_EDGE} strokeWidth={1.1} strokeLinejoin="round">
            {PARTS.map((d) => <path key={d} d={d} />)}
          </g>
          <g clipPath={`url(#${shape})`}>
            <rect x={120} y={-40} width={170} height={520} fill={`url(#${light})`} />
            <g fill="none" stroke={SKIN_EDGE} strokeWidth={1} strokeLinecap="round" opacity={0.7}>
              {CREASES.map((d) => <path key={d} d={d} />)}
            </g>
            <path d={NAIL} fill="#efd6c2" stroke="#c49a7d" strokeWidth={0.8} />
          </g>
        </g>
      </g>

      {/* The hand of leaves, from the left. */}
      <g filter={`url(#${grain})`}>
        <g filter={`url(#${rough})`}>
          <g transform={LEAFY_T}>
            <g clipPath={`url(#${shape})`}>
              <rect x={110} y={-50} width={200} height={540} fill="#24573f" />
              {LEAFY.map((l, i) => (
                <path key={i} d={LEAF_PATH} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.r.toFixed(0)}) scale(${l.k.toFixed(2)})`} fill={LEAVES[l.c]} />
              ))}
            </g>
          </g>
        </g>
        {DRIFT.map((l, i) => (
          <path key={i} d={LEAF_PATH} transform={`translate(${l.x} ${l.y}) rotate(${l.r}) scale(${l.k})`} fill={LEAVES[l.c]} />
        ))}
      </g>
    </svg>
  );
}
