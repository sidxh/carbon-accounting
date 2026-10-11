"use client";

import { AnimatePresence, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Pointer } from "lucide-react";
import { cn } from "@/lib/cn";
import { FORM_PHASES, FormScene, INVENTORY_PHASES, InventoryScene, REDUCE_PHASES, ReduceScene, SCAN_PHASES, ScanScene, UPLOAD_PHASES, UploadScene } from "./flow-scenes";

const EASE = [0.23, 1, 0.32, 1] as const;
const GLIDE = { duration: 0.7, ease: [0.77, 0, 0.175, 1] as const };

// Intro: switch off, the cursor presses, switch on (ms). It plays by itself.
const INTRO = [450, 220, 420];
// Each step's card plays its own stages on a timer (ms per stage).
const SCENES = [UPLOAD_PHASES, SCAN_PHASES, INVENTORY_PHASES, REDUCE_PHASES, FORM_PHASES];
// Scroll given to each step, in viewport heights.
const STEP_VH = 80;

// Scenes slide up when scrolling down and back down when scrolling up.
const slide = {
  enter: (d: number) => ({ transform: `translateY(${d > 0 ? 100 : -100}%)` }),
  center: { transform: "translateY(0%)" },
  exit: (d: number) => ({ transform: `translateY(${d > 0 ? -100 : 100}%)` }),
};

/** The big switch. Purely visual; the flow decides when it is on. CSS moves the knob. */
function Switch({ on, pressed }: { on: boolean; pressed: boolean }) {
  return (
    <span className={cn("relative block h-16 w-[124px] rounded-full border transition-colors duration-500 sm:h-[76px] sm:w-[150px]", on ? "border-signal bg-signal" : "border-line-strong bg-sunken")}>
      <span
        className="absolute left-1.5 top-1.5 block size-[52px] rounded-full bg-raised shadow-[var(--shadow-float)] transition-transform duration-[450ms] ease-[var(--ease-out)] sm:size-16"
        style={{ transform: `translateX(${on ? "calc(100% + 0.25rem)" : "0px"}) scale(${pressed ? 0.94 : 1})` }}
      />
    </span>
  );
}

/**
 * "How it works": the section pins while the page scrolls, and the scroll moves
 * through the five steps on the left, a wheel with the active one bright and the
 * rest fading above and below. The card on the right plays each step's animation
 * by itself when that step comes up (bills dropped into a folder, a bill scanned
 * and a gap asked about, the inventory built, a reduction plan drawn, the
 * questionnaire filled) and then
 * holds its last frame. Arriving at the top, a "Supplier Carbon" switch is first
 * pressed on by itself. Scenes slide up when scrolling down and back when
 * scrolling up; clicking a step scrolls to it. Under reduced motion the switch is
 * skipped and each step shows finished.
 */
export function StepsFlow({ title }: { title: string }) {
  const t = useTranslations("landing.flow");
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const inView = useInView(stage, { amount: 0.5 });
  const reduce = useReducedMotion() ?? false;
  const [scene, setScene] = useState(0);
  const [dir, setDir] = useState(1);
  const [phase, setPhase] = useState(0);
  const [introBeat, setIntroBeat] = useState(0);
  const [introDone, setIntroDone] = useState(false);

  // The scroll picks the step; past the first stretch, the intro is skipped.
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  // The heading's ink: from unlit to fully coloured while the section scrolls in.
  const { scrollYProgress: arriving } = useScroll({ target: track, offset: ["start end", "start start"] });
  const inkIn = useTransform(arriving, (v) => `${reduce ? 0 : 100 - Math.min(1, v * 1.25) * 100}% 0%`);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const s = Math.min(SCENES.length - 1, Math.floor(v * SCENES.length));
    if (s !== scene) { setDir(s > scene ? 1 : -1); setScene(s); setPhase(0); }
    if (v > 0.15 && !introDone) setIntroDone(true);
  });

  // The switch flips itself on once the section is in view.
  const intro = !introDone && !reduce;
  useEffect(() => {
    if (!intro || !inView) return;
    const id = setTimeout(() => {
      if (introBeat === INTRO.length - 1) setIntroDone(true);
      else setIntroBeat(introBeat + 1);
    }, INTRO[introBeat]);
    return () => clearTimeout(id);
  }, [intro, inView, introBeat]);

  // The active step's card plays through its stages, then holds the last one.
  useEffect(() => {
    if (intro || reduce || !inView || phase >= SCENES[scene].length - 1) return;
    const id = setTimeout(() => setPhase(phase + 1), SCENES[scene][phase]);
    return () => clearTimeout(id);
  }, [intro, reduce, inView, scene, phase]);

  /** Scroll to the middle of a step's stretch; the scroll then shows it. */
  const jump = (k: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + ((k + 0.5) / SCENES.length) * range, behavior: reduce ? "auto" : "smooth" });
  };

  const shown = reduce ? SCENES[scene].length - 1 : phase;
  const on = introBeat >= 2;
  const words = [t("words.bills"), t("words.questions"), t("words.inventory"), t("words.reductions"), t("words.questionnaire")];

  return (
    // A tall track to scroll through; the scene itself stays pinned in view.
    <div ref={track} id="how" className="relative" style={{ height: `calc(100dvh + ${(SCENES.length - 1) * STEP_VH}dvh)` }}>
      <div ref={stage} className="sticky top-0 flex h-dvh flex-col justify-center pb-4 pt-[130px]">
        {/* The heading sits near the top and inks in, left to right, as the section arrives. */}
        <motion.h2
          id="how-h"
          className="font-display absolute inset-x-0 top-[84px] px-4 text-center text-3xl text-balance sm:text-4xl"
          style={{
            backgroundImage: "linear-gradient(90deg, var(--signal-ink) 0%, var(--ink) 42%, var(--line-strong) 58%, var(--line-strong) 100%)",
            backgroundSize: "240% 100%",
            backgroundPosition: inkIn,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {title}
        </motion.h2>
        <div className="relative h-[560px] md:h-[480px]">
          <AnimatePresence mode="wait" initial={false}>
            {intro ? (
              <motion.div
                key="intro"
                initial={{ opacity: 0, transform: "scale(0.96)" }}
                animate={{ opacity: 1, transform: "scale(1)" }}
                exit={{ opacity: 0, transform: "scale(1.04)", transition: { duration: 0.2, ease: EASE } }}
                transition={{ duration: 0.35, ease: EASE }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-10"
              >
                <span className="font-display text-5xl text-ink sm:text-7xl">Supplier <em className="text-signal-ink">Carbon</em></span>
                <span className="relative" aria-hidden>
                  <Switch on={on} pressed={introBeat === 1} />
                  {/* The hand that flips it. */}
                  <motion.span
                    className="absolute -bottom-7 right-0 text-ink"
                    initial={{ opacity: 0, transform: "translate(40px, 40px)" }}
                    animate={{ opacity: 1, transform: introBeat >= 1 ? "translate(-6px, -18px) scale(0.92)" : "translate(0px, 0px) scale(1)" }}
                    transition={{ duration: 0.35, ease: EASE }}
                  >
                    <Pointer className="size-12 fill-raised" strokeWidth={1.5} />
                  </motion.span>
                </span>
                <span className="sr-only">{t("on")}</span>
              </motion.div>
            ) : (
              <motion.div
                key="flow"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3, ease: EASE }}
                className="absolute inset-0 grid grid-rows-[170px_1fr] gap-4 md:grid-cols-[1fr_1.1fr] md:grid-rows-1 md:items-center md:gap-10"
              >
                {/* The wheel: the active step on the centre line, the rest fading away from it. */}
                <div className="relative h-full overflow-hidden md:h-[360px]">
                  <ol
                    className="absolute inset-x-0 top-1/2 transition-transform duration-700 ease-[var(--ease-in-out)]"
                    style={{ "--row": "clamp(3rem, 6vw, 4.75rem)", transform: `translateY(calc(${-scene} * var(--row) - var(--row) / 2))` } as React.CSSProperties}
                  >
                    {words.map((w, k) => {
                      const d = Math.abs(k - scene);
                      return (
                        <li key={k} className="flex h-[var(--row)] items-center">
                          <button
                            type="button"
                            onClick={() => jump(k)}
                            aria-current={k === scene ? "step" : undefined}
                            className={cn(
                              "font-display flex items-center gap-4 text-left text-[clamp(2rem,4.2vw,3.5rem)] leading-none transition-[opacity,color] duration-500",
                              k === scene ? "text-ink" : "text-ink-soft hover:opacity-70",
                            )}
                            style={{ opacity: k === scene ? 1 : d === 1 ? 0.32 : 0.12 }}
                          >
                            <span className={cn("size-3 shrink-0 rounded-full bg-signal transition-[opacity,transform] duration-500", k === scene ? "opacity-100" : "scale-50 opacity-0")} aria-hidden />
                            {w}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* The card: each scene slides up into place as the last one leaves. */}
                <div
                  className="relative h-full overflow-hidden rounded-[28px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_40%,var(--signal-bg)_100%)] shadow-[var(--shadow-float)] md:h-[400px]"
                  role="img"
                  aria-label={t("aria")}
                >
                  <AnimatePresence initial={false} custom={dir}>
                    <motion.div
                      key={scene}
                      custom={dir}
                      variants={slide}
                      className="absolute inset-0 p-6 pb-9"
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={GLIDE}
                      aria-hidden
                    >
                      {scene === 0 && <UploadScene phase={shown} />}
                      {scene === 1 && <ScanScene phase={shown} />}
                      {scene === 2 && <InventoryScene phase={shown} />}
                      {scene === 3 && <ReduceScene phase={shown} />}
                      {scene === 4 && <FormScene phase={shown} />}
                    </motion.div>
                  </AnimatePresence>
                  {/* Progress through the four scenes. */}
                  <div className="absolute inset-x-6 bottom-4 flex gap-1" aria-hidden>
                    {SCENES.map((_, k) => (
                      <span key={k} className={cn("h-1 flex-1 rounded-full transition-colors duration-500", k <= scene ? "bg-signal" : "bg-sunken")} />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
