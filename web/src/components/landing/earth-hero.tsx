"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { cubicBezier, motion, useMotionValueEvent, useScroll, useTransform, useVelocity } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { HeroGlobe, Tag, TAGS, TICK } from "./hero-globe";

const EASE = [0.23, 1, 0.32, 1] as const;
// --ease-in-out: the earth is already on screen when it moves.
const GLIDE = cubicBezier(0.77, 0, 0.175, 1);
const STATS = ["factors", "ai", "langs"] as const;

// The first view's ledger: the three gases plus the two scopes, floating round the rim.
const FIRST = [
  { ...TAGS[0], pos: "left-[6%] top-[60%] md:left-[13%] md:top-[64%]" },
  { ...TAGS[1], pos: "right-[4%] top-[57%] md:right-[12%] md:top-[60%]" },
  { ...TAGS[2], pos: "left-[4%] bottom-[18%] md:left-[9%] md:bottom-[16%]" },
] as const;
const SCOPES = [
  { label: "Scope 1", values: [102.4, 103.1, 102.8, 104.0, 103.6, 102.9], dot: "bg-ink-soft", bob: "hg-bob-c", pos: "right-[6%] bottom-[20%] md:right-[9%] md:bottom-[22%]" },
  { label: "Scope 2", values: [372.6, 374.0, 371.9, 375.2, 373.8, 372.1], dot: "bg-signal", bob: "", pos: "right-[14%] bottom-[9%] md:right-[18%] md:bottom-[10%]" },
] as const;

/** 0 before `from`, 1 after `to`, linear between. */
const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)));

// The globe's canvas frames the sphere at two thirds of its box (camera at 5.6, fov 30).
const SPHERE = 0.667;

/**
 * Where the earth sits at the top of the page (A) and once it has moved aside (B),
 * in px from the viewport centre. In A its top edge sits just under the hero copy,
 * measured live, so the two never overlap at any window height.
 */
function useStages(copy: React.RefObject<HTMLDivElement | null>) {
  const [v, setV] = useState({ w: 1440, h: 900, copyBottom: 420 });
  useEffect(() => {
    const el = copy.current;
    // offsetTop/offsetHeight ignore the scroll-linked transform on the copy.
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight, copyBottom: el ? el.offsetTop + el.offsetHeight : 420 });
    on();
    window.addEventListener("resize", on);
    const ro = el ? new ResizeObserver(on) : null;
    if (el) ro?.observe(el);
    return () => { window.removeEventListener("resize", on); ro?.disconnect(); };
  }, [copy]);
  const wide = v.w >= 768; // matches Tailwind `md`, where the story goes beside the earth
  // Box size: wide enough that the risen earth spans most of the first view.
  const S = wide ? Math.min(1500, v.w * 1.3) : Math.min(1150, Math.max(420, v.w * 1.3));
  const d = SPHERE * S;
  // A: centred, top edge a little below the copy (never above 45% of the viewport).
  const top = Math.max(v.copyBottom + (wide ? 72 : 40), 0.45 * v.h);
  const a = { x: 0, y: top - v.h / 2 + d / 2, s: 1 };
  // B: a whole sphere beside the story on wide screens, above it on narrow ones.
  const dB = wide ? Math.min(0.34 * v.w, 0.56 * v.h, 520) : Math.min(0.62 * v.w, 0.34 * v.h);
  const b = wide
    ? { x: Math.min(0.21 * v.w, 330), y: 0.03 * v.h, s: dB / d }
    : { x: 0, y: -0.2 * v.h, s: dB / d };
  return { S, a, b };
}

/**
 * The landing hero as one scroll-driven scene. The page pins for a while: the
 * earth rises from the bottom behind a short headline, then glides aside and
 * shrinks to a whole planet as the story fades in, while an orbit ring draws
 * round it and the gas tags arrive. Scroll speed spins the earth up.
 */
export function EarthHero({ go, cta }: { go: string; cta: string }) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const track = useRef<HTMLElement>(null);
  const { scrollYProgress: p, scrollY } = useScroll({ target: track, offset: ["start start", "end end"] });
  const velocity = useVelocity(scrollY);
  const boost = useTransform(velocity, (v) => Math.min(Math.abs(v) / 1500, 3));
  const copy = useRef<HTMLDivElement>(null);
  const { S, a, b } = useStages(copy);

  const move = [0, 0.55];
  const x = useTransform(p, move, [a.x, b.x], { ease: GLIDE });
  const y = useTransform(p, move, [a.y, b.y], { ease: GLIDE });
  const scale = useTransform(p, move, [a.s, b.s], { ease: GLIDE });
  const reveal = useTransform(p, (v) => ramp(v, 0.25, 0.6));
  const tagScale = useTransform(scale, (v) => 1 / v);

  // Opacities are plain functions of progress: Motion would otherwise hand range
  // maps to the browser's scroll timeline, which drifted from our offsets.
  const heroOpacity = useTransform(p, (v) => 1 - ramp(v, 0, 0.22));
  const heroY = useTransform(p, [0, 0.3], [0, -80]);
  const storyOpacity = useTransform(p, (v) => ramp(v, 0.35, 0.55));
  const storyY = useTransform(p, [0.35, 0.6], [40, 0]);

  // Whichever copy is faded out must not catch clicks.
  const [stage, setStage] = useState<"hero" | "story">("hero");
  useMotionValueEvent(p, "change", (v) => setStage(v < 0.3 ? "hero" : "story"));

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (stage !== "hero") return;
    const id = setInterval(() => setTick((n) => n + 1), TICK);
    return () => clearInterval(id);
  }, [stage]);

  return (
    <section ref={track} className="relative h-[240dvh]" aria-label={t("h1a")}>
      <div className="sticky top-0 h-dvh overflow-hidden">
        {/* The earth */}
        <motion.div
          className="absolute left-1/2 top-1/2"
          style={{ width: S, height: S, marginLeft: -S / 2, marginTop: -S / 2, x, y, scale }}
        >
          <motion.div initial={{ opacity: 0, transform: "translateY(60px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 1.1, delay: 0.15, ease: EASE }} className="size-full">
            <HeroGlobe reveal={reveal} boost={boost} tagScale={tagScale} />
          </motion.div>
        </motion.div>

        {/* First view: headline, one line, one button */}
        <motion.div
          ref={copy}
          style={{ opacity: heroOpacity, y: heroY }}
          className={cn("relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pt-24 text-center sm:pt-[max(6rem,14vh)]", stage !== "hero" && "pointer-events-none")}
        >
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="eyebrow justify-center">{t("eyebrow")}</motion.p>
          <motion.h1 initial={{ opacity: 0, transform: "translateY(16px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 0.6, delay: 0.05, ease: EASE }} className="font-display mt-4 text-[2.9rem] leading-[0.95] text-ink sm:text-[clamp(3rem,8.5vh,5rem)]">
            {t("h1a")}<br /><em className="italic text-signal-ink">{t("h1b")}</em>
          </motion.h1>
          <motion.div initial={{ opacity: 0, transform: "translateY(12px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 0.6, delay: 0.2, ease: EASE }} className="mt-7">
            <Link href={go} className="btn px-6 text-base">{cta}<ArrowRight className="size-4" aria-hidden /></Link>
          </motion.div>
        </motion.div>

        {/* First-view ledger: gas and scope tags round the rim; they hand over to the orbit ring on scroll. */}
        <motion.div style={{ opacity: heroOpacity }} className="hero-globe pointer-events-none absolute inset-0 z-10 hidden sm:block" aria-hidden>
          {FIRST.map((g) => (
            <div key={g.gas} className={cn("absolute", g.pos)}>
              <Tag label={g.gas} value={g.values[tick % g.values.length]} dot={g.dot} bob={g.bob} locale={locale} />
            </div>
          ))}
          {SCOPES.map((g) => (
            <div key={g.label} className={cn("absolute", g.pos)}>
              <Tag label={g.label} value={g.values[tick % g.values.length]} dot={g.dot} bob={g.bob} locale={locale} unit="tCO₂e" digits={1} />
            </div>
          ))}
        </motion.div>

        {/* Scroll cue, sitting on the earth */}
        <motion.button
          type="button"
          style={{ opacity: heroOpacity }}
          onClick={() => window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" })}
          aria-label={t("scrollCue")}
          className={cn("card absolute bottom-6 left-1/2 z-10 grid size-11 -translate-x-1/2 place-items-center rounded-full shadow-[var(--shadow-float)]", stage !== "hero" && "pointer-events-none")}
        >
          <ArrowDown className="size-4 text-ink-soft" aria-hidden />
        </motion.button>

        {/* Second view: the story, beside the earth */}
        <motion.div
          style={{ opacity: storyOpacity, y: storyY }}
          className={cn("absolute inset-x-0 bottom-0 z-10 md:inset-y-0 md:flex md:items-center", stage !== "story" && "pointer-events-none")}
          aria-hidden={stage !== "story"}
        >
          <div className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-8 md:pb-0">
            <div className="max-w-lg md:max-w-[min(520px,46%)]">
              <p className="eyebrow">{t("story.eyebrow")}</p>
              <h2 className="font-display mt-4 text-4xl leading-[1.02] text-ink text-balance sm:text-5xl">{t("story.title")}</h2>
              <p className="mt-5 text-[16px] leading-relaxed text-ink-soft">{t("sub")}</p>
              <dl className="mt-8 grid grid-cols-3 gap-4 border-t hairline pt-6">
                {STATS.map((k) => (
                  <div key={k} className="flex flex-col gap-1">
                    <dt className="order-2 text-xs leading-snug text-muted">{t(`stats.${k}.label`)}</dt>
                    <dd className="order-1 font-display text-4xl leading-none text-ink">{t(`stats.${k}.value`)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
