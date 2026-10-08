"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { LANGUAGE_NAMES, setLocaleCookie } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";

// Illustration colours: misty greens from the paper down to the footer's ground.
// They are a picture, not tokens.
const MIST = ["#dce9e4", "#bcd8cf", "#94c1b4", "#5f9e8f", "#2f7568", "#145a51"];
const GROUND = "#0d4a43";

/** Seeded pines along a ridge, as one path: each a stack of three triangles on a trunk. */
function pines(seed: number, from: number, to: number, base: (x: number) => number, count: number, size: number) {
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

function Turbine({ x, y, h }: { x: number; y: number; h: number }) {
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

/** The landscape: misty ridges and a lake, pines, turbines, a farmhouse with solar, a big tree. */
function Landscape() {
  return (
    <svg viewBox="0 0 1440 420" preserveAspectRatio="xMidYMax slice" className="block h-[260px] w-full sm:h-[340px] lg:h-[420px]" aria-hidden>
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
      {/* Farmhouse with a solar roof. */}
      <g>
        <rect x={950} y={268} width={52} height={30} fill={MIST[5]} />
        <path d="M944 270 L976 248 L1008 270 Z" fill={GROUND} />
        <path d="M978 262 L1000 262 L1006 268 L984 268 Z" fill="#9cc7d8" opacity={0.85} />
        <path d="M952 262 L974 262 L968 268 L946 268 Z" fill="#9cc7d8" opacity={0.85} />
        <rect x={970} y={282} width={9} height={16} fill={GROUND} />
      </g>
      {/* The big tree. */}
      <g fill={GROUND}>
        <path d="M1144 262 C1142 224 1150 206 1156 186 L1164 186 C1166 210 1170 232 1168 262 Z" />
        <path d="M1156 206 C1140 196 1126 194 1112 198 M1164 196 C1180 184 1194 182 1208 186" stroke={GROUND} strokeWidth={5} fill="none" strokeLinecap="round" />
        <ellipse cx={1160} cy={140} rx={62} ry={44} />
        <ellipse cx={1112} cy={170} rx={40} ry={26} />
        <ellipse cx={1212} cy={168} rx={42} ry={27} />
        <ellipse cx={1162} cy={104} rx={38} ry={28} />
      </g>
      {/* Ground, running into the footer. */}
      <path d="M0 372 Q360 350 720 362 T1440 352 V420 H0Z" fill={GROUND} />
    </svg>
  );
}

const STANDARDS = [
  { name: "GHG Protocol", href: "https://ghgprotocol.org" },
  { name: "CDP", href: "https://www.cdp.net" },
  { name: "DEFRA conversion factors", href: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting" },
  { name: "IPCC EFDB", href: "https://www.ipcc-nggip.iges.or.jp/EFDB/" },
];

/**
 * The landing footer: an illustrated landscape (misty ridges, a lake, pines, wind
 * turbines, a farmhouse with a solar roof and a big tree) that settles into deep
 * green ground carrying the links: the page's own sections, the standards the
 * numbers are cited from, and the language.
 */
export function LandscapeFooter({ go, cta }: { go: string; cta: string }) {
  const t = useTranslations("landing.footer");
  const tl = useTranslations("landing");
  const locale = useLocale();
  const router = useRouter();
  const heading = "mb-4 text-xs font-semibold uppercase text-signal-on/60";
  const link = "text-sm text-signal-on/90 transition-colors hover:text-signal-on";

  return (
    <footer className="relative mt-8" style={{ backgroundColor: GROUND }}>
      <div className="bg-paper"><Landscape /></div>
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-signal-on">
        <div className="grid gap-10 border-b border-signal-on/15 pb-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.3fr_1fr] lg:divide-x lg:divide-signal-on/15">
          <div className="lg:pr-8">
            <div className="[&_*]:!text-signal-on"><Wordmark /></div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-signal-on/75">{t("blurb")}</p>
          </div>
          <nav aria-label={t("product")} className="lg:px-8">
            <h2 className={heading}>{t("product")}</h2>
            <ul className="space-y-3">
              <li><a href="#how" className={link}>{t("how")}</a></li>
              <li><a href="#features" className={link}>{t("features")}</a></li>
              <li><Link href={go} className={link}>{cta}</Link></li>
            </ul>
          </nav>
          <nav id="standards" aria-label={t("standards")} className="lg:px-8">
            <h2 className={heading}>{t("standards")}</h2>
            <ul className="space-y-3">
              {STANDARDS.map((s) => (
                <li key={s.name}>
                  <a href={s.href} target="_blank" rel="noreferrer" className={cn(link, "inline-flex items-center gap-1")}>
                    {s.name}<ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="lg:pl-8">
            <h2 className={heading}>{tl("footerLangs")}</h2>
            <ul className="space-y-3">
              {Object.entries(LANGUAGE_NAMES).map(([k, v]) => (
                <li key={k}>
                  <button
                    type="button"
                    lang={k}
                    aria-current={k === locale ? "true" : undefined}
                    onClick={() => { setLocaleCookie(k); router.refresh(); }}
                    className={cn(link, k === locale && "font-semibold text-signal-on underline underline-offset-4")}
                  >
                    {v}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-6 text-xs text-signal-on/60 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Supplier Carbon</span>
          <span>{tl("footerNote")}</span>
        </div>
      </div>
    </footer>
  );
}
