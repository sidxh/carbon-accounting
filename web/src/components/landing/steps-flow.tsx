"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pointer } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePageVisible } from "./hero-demo";
import { FORM_PHASES, FormScene, INVENTORY_PHASES, InventoryScene, SCAN_PHASES, ScanScene, UPLOAD_PHASES, UploadScene } from "./flow-scenes";

const EASE = [0.23, 1, 0.32, 1] as const;
const GLIDE = { duration: 0.7, ease: [0.77, 0, 0.175, 1] as const };

// Intro: switch off, the cursor presses, switch on. Then the four scenes, then a beat to fade out.
const INTRO = [450, 220, 420];
const SCENES = [UPLOAD_PHASES, SCAN_PHASES, INVENTORY_PHASES, FORM_PHASES];
const OUTRO = 450;

type Beat = { scene: number; phase: number; ms: number }; // scene -1 = intro, 4 = outro

/** The whole loop as one flat list of beats, so one timer can walk it. */
function useBeats() {
  return useMemo<Beat[]>(() => [
    ...INTRO.map((ms, phase) => ({ scene: -1, phase, ms })),
    ...SCENES.flatMap((phases, scene) => phases.map((ms, phase) => ({ scene, phase, ms }))),
    { scene: 4, phase: 0, ms: OUTRO },
  ], []);
}

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
 * "How it works" as one looping scene. A "Supplier Carbon" switch is pressed on;
 * it gives way to a wheel of four steps on the left, the active one bright with
 * the rest fading above and below, and a tall card on the right whose scenes slide
 * up one after another: bills fed into a folder, a bill scanned and a gap asked
 * about, the inventory built, the questionnaire filled. Then it switches off and starts again.
 *
 * One timer walks a flat list of beats and keeps the time left on the current one,
 * so hovering the card pauses it exactly. Clicking a step jumps to it. Off-screen
 * or in a hidden tab it stops; under reduced motion it skips the intro and shows
 * each scene finished.
 */
export function StepsFlow() {
  const t = useTranslations("landing.flow");
  const beats = useBeats();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const visible = usePageVisible();
  const reduce = useReducedMotion() ?? false;
  const [held, setHeld] = useState(false);
  const [i, setI] = useState(0);
  const remaining = useRef(beats[0].ms);
  const running = inView && visible && !reduce && !held;

  useEffect(() => {
    if (!running) return;
    let fired = false;
    const start = performance.now();
    const id = setTimeout(() => {
      fired = true;
      const next = (i + 1) % beats.length;
      remaining.current = beats[next].ms;
      setI(next);
    }, remaining.current);
    return () => {
      clearTimeout(id);
      if (!fired) remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [i, running, beats]);

  const startOf = (scene: number) => beats.findIndex((b) => b.scene === scene);
  const jump = (scene: number) => {
    const at = startOf(scene);
    remaining.current = beats[at].ms;
    setI(at);
  };

  // Under reduced motion: no intro, and every scene at its finished frame.
  const beat = reduce && beats[i].scene === -1 ? beats[startOf(0)] : beats[i];
  const intro = beat.scene === -1;
  const scene = Math.min(beat.scene, 3);
  const phase = reduce ? SCENES[scene].length - 1 : beat.scene === 4 ? SCENES[3].length - 1 : beat.phase;
  const on = !intro || beat.phase >= 2;
  const words = [t("words.bills"), t("words.questions"), t("words.inventory"), t("words.questionnaire")];

  return (
    <div ref={ref} className="relative h-[620px] md:h-[480px]">
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
              <Switch on={on} pressed={beat.phase === 1} />
              {/* The hand that flips it. */}
              <motion.span
                className="absolute -bottom-7 right-0 text-ink"
                initial={{ opacity: 0, transform: "translate(40px, 40px)" }}
                animate={{ opacity: 1, transform: beat.phase >= 1 ? "translate(-6px, -18px) scale(0.92)" : "translate(0px, 0px) scale(1)" }}
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
            animate={{ opacity: beat.scene === 4 ? 0 : 1 }}
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
              onMouseEnter={() => setHeld(true)}
              onMouseLeave={() => setHeld(false)}
              role="img"
              aria-label={t("aria")}
            >
              <AnimatePresence initial={false}>
                <motion.div
                  key={scene}
                  className="absolute inset-0 p-6 pb-9"
                  initial={{ transform: "translateY(100%)" }}
                  animate={{ transform: "translateY(0%)" }}
                  exit={{ transform: "translateY(-100%)" }}
                  transition={GLIDE}
                  aria-hidden
                >
                  {scene === 0 && <UploadScene phase={phase} />}
                  {scene === 1 && <ScanScene phase={phase} />}
                  {scene === 2 && <InventoryScene phase={phase} />}
                  {scene === 3 && <FormScene phase={phase} />}
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
  );
}
