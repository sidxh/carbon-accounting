"use client";

import { motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Crosshair, FileSpreadsheet, MessageCircleQuestion, ScanText, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePageVisible } from "./hero-demo";
import { Fullerene } from "./fullerene";

/** 0 before `from`, 1 after `to`, linear between. */
const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)));

// How often the role in the headline rolls on (ms).
const ROLL_MS = 1700;

/**
 * "We are your …" on one line, with the role rolling vertically like a slot reel:
 * the current one bright, the one before and after faint above and below, the
 * rest hidden. The roles are all about the same length, and the reel is as wide
 * as the longest, so the line stays centred whichever role is on show.
 */
function RoleReel({ lead, roles, running }: { lead: string; roles: string[]; running: boolean }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setK((n) => n + 1), ROLL_MS);
    return () => clearInterval(id);
  }, [running]);
  const n = roles.length;
  const at = ((k % n) + n) % n;

  // Width of the longest role, measured (again once fonts load, and on resize).
  const items = useRef<(HTMLSpanElement | null)[]>([]);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const measure = () => setWidth(Math.max(...items.current.map((el) => el?.offsetWidth ?? 0)));
    measure();
    // Garamond may arrive after first paint and is wider than its fallback.
    document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [roles]);

  return (
    <p className="font-display flex flex-col items-center gap-x-[0.3em] text-[clamp(2.4rem,6.2vw,5.75rem)] leading-[1.1] text-ink md:flex-row md:justify-center">
      <span className="shrink-0">{lead}</span>
      {/* Three lines tall: previous, current, next. */}
      <span
        className="relative block h-[3.3em] w-full shrink-0 overflow-hidden md:w-[var(--reel)]"
        style={{ "--reel": width ? `${width}px` : "11em" } as React.CSSProperties}
        aria-live="polite"
      >
        {roles.map((r, i) => {
          // Signed distance from the current role, wrapped round the list.
          let d = i - at;
          if (d > n / 2) d -= n;
          if (d < -n / 2) d += n;
          return (
            <span
              key={r}
              aria-hidden={d !== 0}
              className={cn(
                "absolute inset-x-0 top-[1.1em] text-center italic transition-[transform,opacity] duration-500 ease-[var(--ease-in-out)] md:text-left",
                d === 0 ? "text-signal-ink" : "text-signal",
              )}
              style={{ transform: `translateY(${d * 1.1}em)`, opacity: d === 0 ? 1 : Math.abs(d) === 1 ? 0.18 : 0 }}
            >
              {/* The inner span is what gets measured: just the words, not the full row. */}
              <span ref={(el) => { items.current[i] = el; }} className="whitespace-nowrap">{r}</span>
            </span>
          );
        })}
      </span>
    </p>
  );
}

// Six things the product does, said in a line each. See agent/app.
const FEATURES: { key: string; icon: LucideIcon }[] = [
  { key: "reads", icon: ScanText },
  { key: "checks", icon: ShieldCheck },
  { key: "asks", icon: MessageCircleQuestion },
  { key: "evidence", icon: Crosshair },
  { key: "outputs", icon: FileSpreadsheet },
  { key: "advisor", icon: Sun },
];

/**
 * The features section. It pins briefly while the page scrolls: a C60 molecule
 * turns in the middle, then bursts apart, and out of the burst comes "We are your
 * …" with the role rolling through the jobs it stands in for. Right below, six
 * feature cards in a plain grid.
 */
const CARD = "flex gap-4 rounded-[24px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_50%,var(--signal-bg)_100%)] p-5 shadow-[var(--shadow-raised)] md:p-4 lg:p-5";

function CardBody({ k, icon: Icon, t }: { k: string; icon: LucideIcon; t: (key: string) => string }) {
  return (
    <>
      <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-signal text-signal-on"><Icon className="size-5" aria-hidden /></span>
      <span>
        <span className="font-display block text-xl leading-tight text-ink">{t(`items.${k}.title`)}</span>
        <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{t(`items.${k}.body`)}</span>
      </span>
    </>
  );
}

/** A feature card inside the pinned frame: fades up with the scroll, a beat after the one before. */
function PinnedCard({ i, p, children }: { i: number; p: MotionValue<number>; children: React.ReactNode }) {
  const start = 0.6 + i * 0.03;
  const opacity = useTransform(p, (v) => ramp(v, start, start + 0.12));
  const y = useTransform(p, (v) => (1 - ramp(v, start, start + 0.12)) * 24);
  return <motion.li style={{ opacity, y }} className={CARD}>{children}</motion.li>;
}

/**
 * The features section. It pins briefly while the page scrolls: a C60 molecule
 * turns in the middle, then bursts apart; out of the burst comes "We are your …"
 * with the role rolling through the jobs it stands in for, and right under it,
 * in the same view, six feature cards. On phones, where they cannot share one
 * screen, the cards follow below instead.
 */
export function Features() {
  const t = useTranslations("landing.features");
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const headInView = useInView(head, { amount: 0.5 });
  const visible = usePageVisible();
  const reduce = useReducedMotion() ?? false;
  const roles = t.raw("roles") as string[];
  const { scrollYProgress: p } = useScroll({ target: track, offset: ["start start", "end end"] });

  // Molecule: grows in, then bursts. Headline: arrives with the burst. Cards: just after.
  const burst = useTransform(p, (v) => (reduce ? 0 : ramp(v, 0.25, 0.7)));
  const ballScale = useTransform(p, (v) => 0.75 + 0.25 * ramp(v, 0, 0.25));
  const ballOpacity = useTransform(p, (v) => (reduce ? 1 - ramp(v, 0.3, 0.5) : 1));
  const headOpacity = useTransform(p, (v) => ramp(v, 0.42, 0.62));
  const headScale = useTransform(p, (v) => 0.9 + 0.1 * ramp(v, 0.42, 0.7));

  return (
    // Pulled up a quarter screen so the molecule starts arriving as the steps
    // finish, instead of after half a screen of empty page.
    <section id="features" aria-labelledby="features-h" className="relative -mt-[25dvh]">
      {/* Pinned: molecule, burst, headline, and the features under it. */}
      <div ref={track} className="relative h-[200dvh]">
        <div className="sticky top-0 flex h-dvh flex-col items-center justify-center gap-10 overflow-hidden pt-16 lg:gap-14">
          <motion.div style={{ scale: ballScale, opacity: ballOpacity }} className="pointer-events-none absolute inset-0">
            <Fullerene burst={burst} className="size-full" />
          </motion.div>
          <motion.div ref={head} style={{ opacity: headOpacity, scale: headScale }} className="relative z-10 w-full px-4">
            <h2 id="features-h" className="sr-only">{`${t("lead")} ${roles[0]}`}</h2>
            <RoleReel lead={t("lead")} roles={roles} running={headInView && visible && !reduce} />
          </motion.div>
          <ul className="relative z-10 mx-auto hidden w-full max-w-6xl gap-3 px-4 md:grid md:grid-cols-3 lg:gap-4">
            {FEATURES.map(({ key, icon }, i) => (
              <PinnedCard key={key} i={i} p={p}><CardBody k={key} icon={icon} t={t} /></PinnedCard>
            ))}
          </ul>
        </div>
      </div>

      {/* Phones: the features follow the headline. */}
      <ul className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 md:hidden">
        {FEATURES.map(({ key, icon }, i) => (
          <motion.li
            key={key}
            initial={{ opacity: 0, transform: "translateY(20px)" }}
            whileInView={{ opacity: 1, transform: "translateY(0px)" }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: (i % 2) * 0.08, ease: [0.23, 1, 0.32, 1] }}
            className={CARD}
          >
            <CardBody k={key} icon={icon} t={t} />
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
