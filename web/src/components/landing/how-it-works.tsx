"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ACT_END, ACT_START, LAST, TIMELINE, actOf, usePageVisible } from "./hero-demo";
import { StepsCarousel } from "./steps-carousel";

/** How long each act of the demo lasts, summed from its steps. */
const ACT_MS = ACT_START.map((start, a) => TIMELINE.slice(start, ACT_END[a] + 1).reduce((x, y) => x + y, 0));

/**
 * The clock behind the steps carousel. It walks the demo's timeline, so each step
 * stays open as long as its act of the demo lasts, and the carousel opens whichever
 * act it is in. Clicking a panel jumps there and plays on; otherwise hovering or
 * focusing the carousel pauses it. The clock keeps the time left on the current
 * step, so a pause resumes where it stopped and the progress bar stays in step.
 */
export function HowItWorks({ steps }: { steps: { icon: LucideIcon; key: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.15 });
  const visible = usePageVisible();
  const reduce = useReducedMotion() ?? false;
  const [held, setHeld] = useState(false);
  // A click plays the picked step even though the pointer is still over the carousel;
  // hover pauses again once the pointer has left.
  const [picked, setPicked] = useState(false);
  const [step, setStep] = useState(0);
  const [epoch, setEpoch] = useState(0); // bumps on every loop and jump, restarting the bars
  const remaining = useRef(TIMELINE[0]);
  const running = inView && visible && !reduce && (!held || picked);

  useEffect(() => {
    if (!running) return;
    let fired = false;
    const start = performance.now();
    const id = setTimeout(() => {
      fired = true;
      const next = step === LAST ? 0 : step + 1;
      remaining.current = TIMELINE[next];
      if (next === 0) setEpoch((e) => e + 1);
      setStep(next);
    }, remaining.current);
    return () => {
      clearTimeout(id);
      if (!fired) remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [step, running]);

  const pick = (i: number) => {
    // Under reduced motion there is no playback: show the act's finished frame.
    const target = reduce ? ACT_END[i] : ACT_START[i];
    remaining.current = TIMELINE[target];
    setEpoch((e) => e + 1);
    setStep(target);
    setPicked(true);
  };

  const hold = (h: boolean) => {
    if (!h) setPicked(false);
    setHeld(h);
  };

  const act = actOf(step);
  const open = act === -1 ? steps.length - 1 : act; // the fade before looping keeps the last step open

  return (
    <div ref={ref}>
      <div>
        <StepsCarousel
          steps={steps}
          open={open}
          onPick={pick}
          stepMs={ACT_MS[open]}
          epoch={epoch}
          running={running}
          still={reduce}
          onHold={hold}
        />
      </div>
    </div>
  );
}
