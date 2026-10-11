import { useId } from "react";
import { Farmhouse, GROUND, MIST, Tree, Turbine, pines } from "./landscape";

// Factory smoke that becomes a landscape: the sign-in page's picture, after the
// tubik illustration (mirrored, so the smoke flows towards the form). Two
// chimneys stand on a long, low factory; the landscape rises straight out of
// their tops, its foot flicked with white crescents, fills the top of the page
// and runs right behind the sign-in column, a stippled ribbon of smoke along its
// foot. Inside, the landing footer's landscape: misty ridges, a lake, pines,
// turning turbines, a farmhouse and a big tree over deep green ground. Colours
// are illustration colours, not tokens.

const SMOKE = "#b7b3c6";
const STACK = "#78737f";
const BAND = "#ebe8ef";

// Where the factory roof is; the chimneys stand on it.
const ROOF = 930;

// The landscape: from the far (left) edge, along its flicked foot to the short
// chimney, up between the two to the tall one, out round a bulge, then on to the
// right across the page behind the sign-in column.
const GREEN =
  "M-40 668 C40 672 110 682 160 700 C192 712 212 734 220 760 L258 760 C266 724 286 690 305 664 L355 664 C384 642 420 622 452 612 C482 602 502 584 512 562 C530 520 566 482 620 456 C700 418 800 410 900 420 C980 400 1040 460 1120 450 C1200 440 1240 400 1320 410 C1380 418 1420 412 1460 404 C1520 396 1580 392 1640 396 L1640 -10 L-40 -10 Z";
// The smoke ribbon along its foot: wavy, thinning out to a point behind the form.
const RIBBON =
  "M512 562 C530 520 566 482 620 456 C700 418 800 410 900 420 C980 400 1040 460 1120 450 C1200 440 1240 400 1320 410 C1380 418 1420 412 1460 404 C1400 444 1350 444 1300 456 C1230 474 1180 506 1120 504 C1040 502 980 514 900 504 C800 494 720 500 650 530 C600 552 560 576 512 562 Z";

// The landscape's lines, rising a little to the right: far ridges, the mid hills
// the pines stand on, the near hill with the turbines, and the ground. The near
// hill and ground drop away under the smoke past the turbines, so only the pale
// ridges sit behind the sign-in text.
const far = (x: number) => 250 - 0.06 * x + 20 * Math.sin(x / 160);
const ridge = (x: number) => 320 - 0.06 * x + 16 * Math.sin(x / 130 + 2);
const mid = (x: number) => 410 - 0.07 * Math.min(x, 900) - 18 * Math.sin(x / 150) - 10 * Math.sin(x / 57 + 1);
const near = (x: number) => 520 - 0.08 * Math.min(x, 700) + 0.12 * Math.max(0, x - 700) + 14 * Math.sin(x / 180);
const ground = (x: number) => 610 - 0.09 * Math.min(x, 700) + 0.12 * Math.max(0, x - 700) + 6 * Math.sin(x / 90);
/** A filled band under a line, from the left edge to the right. */
const under = (f: (x: number) => number) =>
  `M-40 ${f(-40).toFixed(1)} ${Array.from({ length: 58 }, (_, i) => `L${-40 + i * 30} ${f(-40 + i * 30).toFixed(1)}`).join(" ")} V1000 H-40Z`;

/** Stipple: pale and dark dots scattered over the shape, as in a print. */
function Stipple({ id }: { id: string }) {
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="3" result="noise" />
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  8 0 0 0 -4.75" result="light" />
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.56  0 0 0 0 0.54  0 0 0 0 0.64  -8 0 0 0 3.05" result="dark" />
      <feComposite in="light" in2="SourceGraphic" operator="in" result="l" />
      <feComposite in="dark" in2="SourceGraphic" operator="in" result="d" />
      <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="d" /><feMergeNode in="l" /></feMerge>
    </filter>
  );
}

/** A chimney, tapering towards a flat top, with pale bands. */
function Chimney({ cx, top, wTop, wBot, bands }: { cx: number; top: number; wTop: number; wBot: number; bands: number[] }) {
  const at = (y: number) => wTop + ((wBot - wTop) * (y - top)) / (ROOF - top);
  const edge = (y: number) => [cx - at(y) / 2, cx + at(y) / 2];
  const [l0, r0] = edge(top), [l1, r1] = edge(ROOF);
  return (
    <g>
      <path d={`M${l0} ${top} L${r0} ${top} L${r1} ${ROOF} L${l1} ${ROOF} Z`} fill={STACK} />
      {bands.map((y) => {
        const [a, b] = edge(y), [c, d] = edge(y + 12);
        return <path key={y} d={`M${a} ${y} L${b} ${y} L${d} ${y + 12} L${c} ${y + 12} Z`} fill={BAND} />;
      })}
    </g>
  );
}

/**
 * The sign-in page's illustration. Anchored to the bottom left by default, so the
 * factory and chimneys stay in view however the space is cropped.
 */
export function Smokescape({ className, preserve = "xMinYMax slice" }: { className?: string; preserve?: string }) {
  // Ids unique to this copy: the page draws it twice (desktop and phone) and a
  // hidden copy's clip path would otherwise be the one the visible copy uses.
  const id = useId().replace(/:/g, "");
  const green = `${id}-green`, sky = `${id}-sky`, grain = `${id}-grain`, speck = `${id}-speck`;
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio={preserve} className={className} aria-hidden>
      <defs>
        <clipPath id={green}><path d={GREEN} /></clipPath>
        <linearGradient id={sky} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f6efe8" />
          <stop offset="1" stopColor="#e7efec" />
        </linearGradient>
        {/* Fine grain, multiplied onto whatever it is applied to (and nothing else). */}
        <filter id={grain} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="noise" />
          <feColorMatrix in="noise" type="saturate" values="0" result="grey" />
          <feComponentTransfer in="grey" result="faint"><feFuncA type="table" tableValues="0 0.3" /></feComponentTransfer>
          <feComposite in="faint" in2="SourceGraphic" operator="in" result="speckle" />
          <feBlend in="SourceGraphic" in2="speckle" mode="multiply" />
        </filter>
        <Stipple id={speck} />
      </defs>

      {/* The landscape, rising out of the chimneys. */}
      <g filter={`url(#${grain})`}>
        <g clipPath={`url(#${green})`}>
          <rect x={-40} y={-10} width={1700} height={800} fill={`url(#${sky})`} />
          <path d={under(far)} fill={MIST[0]} />
          <path d={under(ridge)} fill={MIST[1]} />
          <path d="M250 318 Q360 304 470 306 Q360 326 250 318Z" fill="#eef5f2" opacity={0.9} />
          <path d={under(mid)} fill={MIST[2]} />
          <path d={pines(7, -20, 640, mid, 24, 40)} fill={MIST[3]} />
          <path d={under(near)} fill={MIST[4]} />
          <Farmhouse x={226} y={near(252)} />
          <Tree x={110} y={near(110) + 4} s={0.9} />
          <path d={under(ground)} fill={GROUND} />
        </g>
      </g>

      {/* The turbines, turning: kept out of the grain so it is not redrawn every frame. */}
      <g clipPath={`url(#${green})`}>
        <Turbine x={392} y={near(392) + 2} h={92} />
        <Turbine x={462} y={near(462) + 2} h={76} />
        <Turbine x={524} y={near(524) + 2} h={62} />
      </g>

      {/* White crescents where the landscape leaves the chimneys. */}
      <g fill="#ffffff">
        <path d="M398 632 C442 618 486 594 514 552 C500 600 456 626 398 632 Z" />
        <path d="M258 724 C274 700 296 688 322 686 C300 696 280 708 258 724 Z" />
        <path d="M176 712 C120 694 50 684 -30 682 C46 676 122 682 176 712 Z" />
      </g>

      {/* The smoke: a stippled ribbon along the landscape's foot. */}
      <g filter={`url(#${speck})`}>
        <path d={RIBBON} fill={SMOKE} />
      </g>
      <g fill="none" stroke="#ffffff" strokeLinecap="round">
        <path d="M566 534 C620 498 700 466 800 458 C880 452 960 470 1040 476 C1120 482 1200 462 1260 446 C1300 436 1340 432 1380 428" strokeWidth={3} opacity={0.85} />
        <path d="M700 492 C780 474 860 472 940 480" strokeWidth={2} opacity={0.7} />
      </g>

      {/* The factory: long and low, the chimneys towards its left. */}
      <g filter={`url(#${grain})`}>
        <rect x={70} y={ROOF} width={590} height={1000 - ROOF} fill={STACK} />
        <rect x={70} y={ROOF - 6} width={590} height={7} fill="#68636f" />
        {[430, 520, 600].map((x) => <rect key={x} x={x} y={ROOF - 18} width={30} height={13} rx={2} fill="#68636f" />)}
        <path d={`M76 ${ROOF} V${ROOF - 34} M90 ${ROOF} V${ROOF - 34} M76 ${ROOF - 12} H90 M76 ${ROOF - 24} H90 M640 ${ROOF} V${ROOF - 30} M654 ${ROOF} V${ROOF - 30} M640 ${ROOF - 12} H654 M640 ${ROOF - 22} H654`} stroke="#68636f" strokeWidth={3} fill="none" />
        {[110, 150, 400, 440, 480, 530, 580, 620].map((x) => <rect key={x} x={x} y={ROOF + 20} width={11} height={26} rx={1} fill="#46424c" />)}
        <Chimney cx={239} top={760} wTop={38} wBot={56} bands={[804]} />
        <Chimney cx={330} top={664} wTop={50} wBot={76} bands={[712, 770]} />
      </g>
    </svg>
  );
}

