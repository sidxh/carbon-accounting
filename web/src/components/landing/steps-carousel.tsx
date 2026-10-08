"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SWAP = { duration: 0.7, ease: EASE_IN_OUT };

/**
 * The four steps as a horizontal accordion: tall panels split by hairlines, a big
 * numeral in each. The open panel widens, turns solid green and shows its text;
 * the rest fold to a pale numeral with the step's name running up the side. Each
 * panel's top edge is its progress bar.
 *
 * It holds no clock: `HowItWorks` tells it which step is open, how long that step
 * lasts, and whether time is running, so it moves in lockstep with the demo above.
 * Widths change through Motion's `layout` (a transform), never by animating width.
 */
export function StepsCarousel({
  steps, open, onPick, stepMs, epoch, running, still, onHold,
}: {
  steps: { icon: LucideIcon; key: string }[];
  open: number;
  onPick: (i: number) => void;
  stepMs: number;
  epoch: number;
  running: boolean;
  still: boolean;
  onHold: (held: boolean) => void;
}) {
  const t = useTranslations("landing");

  return (
    <div
      className="card overflow-hidden shadow-[var(--shadow-float)]"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={() => onHold(false)}
    >
      <ol className="flex h-[360px] sm:h-[400px]">
        {steps.map(({ icon: Icon, key }, i) => {
          const isOpen = i === open;
          const done = i < open;
          const title = t(`steps.${key}.title`);
          return (
            <motion.li
              key={key}
              layout
              transition={{ layout: SWAP }}
              className={cn("group relative min-w-0 overflow-hidden", i > 0 && "border-l hairline")}
              style={{ flex: isOpen ? "4.5 1 0%" : "1 1 0%" }}
            >
              {/* Green fill for the open panel, faded rather than repainted. */}
              <motion.span
                aria-hidden
                className="absolute inset-0 bg-signal"
                initial={false}
                animate={{ opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.5, ease: EASE_OUT }}
              />

              {/* Top edge: this step's progress bar. */}
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", isOpen ? "bg-signal-on/25" : "bg-sunken")}>
                <span
                  key={`${epoch}-${open}`}
                  className={cn(
                    "block h-full origin-left",
                    isOpen ? "bg-signal-on" : "bg-signal",
                    done || (isOpen && still) ? "scale-x-100" : !isOpen ? "scale-x-0" : "",
                  )}
                  style={isOpen && !still ? { animation: `steps-fill ${stepMs}ms linear forwards`, animationPlayState: running ? "running" : "paused" } : undefined}
                />
              </span>

              <button
                type="button"
                onClick={() => onPick(i)}
                aria-expanded={isOpen}
                aria-label={`${i + 1}. ${title}`}
                className="absolute inset-0 text-left outline-offset-[-4px]"
              >
                {/* Folded panels: the step's name runs up the side. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 top-6 -translate-x-1/2 rotate-180 whitespace-nowrap text-xs font-medium transition-opacity duration-300 [writing-mode:vertical-rl]",
                    isOpen ? "opacity-0" : done ? "text-signal-ink opacity-100" : "text-muted opacity-100",
                  )}
                >
                  {title}
                </span>

                {/* The numeral: pops up when its panel opens. */}
                <motion.span
                  layout="position"
                  transition={{ layout: SWAP }}
                  aria-hidden
                  className="absolute bottom-1 left-3 select-none sm:left-5"
                >
                  <motion.span
                    key={isOpen ? "open" : "shut"}
                    initial={isOpen ? { opacity: 0.4, transform: "translateY(36px) scale(0.9)" } : false}
                    animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                    transition={{ duration: 0.6, delay: 0.15, ease: EASE_OUT }}
                    className={cn(
                      "font-display block origin-bottom-left font-medium leading-[0.78] transition-colors duration-500",
                      "text-[5rem] sm:text-[11.5rem]",
                      isOpen ? "text-signal-on" : done ? "text-signal/60 group-hover:text-signal" : "text-signal/30 group-hover:text-signal/60",
                    )}
                  >
                    {i + 1}
                  </motion.span>
                </motion.span>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="copy"
                      initial={{ opacity: 0, transform: "translateY(14px)" }}
                      animate={{ opacity: 1, transform: "translateY(0px)", transition: { duration: 0.45, delay: 0.55, ease: EASE_OUT } }}
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      className="absolute inset-x-0 top-0 flex flex-col gap-3 p-5 pt-7 sm:bottom-0 sm:left-[40%] sm:top-auto sm:max-w-sm sm:p-8"
                    >
                      <span className="grid size-10 place-items-center rounded-[10px] bg-signal-on/15 text-signal-on"><Icon className="size-5" aria-hidden /></span>
                      <span className="font-display text-[1.75rem] leading-tight text-signal-on">{title}</span>
                      <span className="text-sm leading-relaxed text-signal-on/80">{t(`steps.${key}.body`)}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
