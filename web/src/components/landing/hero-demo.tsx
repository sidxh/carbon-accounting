"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileImage, FileText, Sparkles, UploadCloud } from "lucide-react";
import { cn } from "@/lib/cn";

const EASE = [0.23, 1, 0.32, 1] as const;
const enter = { duration: 0.22, ease: EASE };

// Milliseconds each step holds before the next. Acts: 0–4 bills, 5–7 questions,
// 8–9 inventory, 10–11 questionnaire, 12 fade before looping.
export const TIMELINE = [400, 450, 450, 600, 1300, 1900, 1300, 1700, 2300, 1600, 1900, 2000, 500];
export const LAST = TIMELINE.length - 1;
export const FINAL = 11;
/** First step of each act, for jumping straight to one. */
export const ACT_START = [0, 5, 8, 10];
/** Last step of each act: its fully built frame, shown still under reduced motion. */
export const ACT_END = [4, 7, 9, 11];

export function actOf(step: number) {
  if (step <= 4) return 0;
  if (step <= 7) return 1;
  if (step <= 9) return 2;
  if (step <= 11) return 3;
  return -1;
}

const BARS = [0.62, 0.58, 0.66, 0.71, 0.84, 0.93, 1, 0.96, 0.82, 0.7, 0.64, 0.68];
const GAP = new Set([6, 7, 8]);

export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Counts from 0 to `to` shortly after mounting, so each loop re-runs the count. */
function Counter({ to, still }: { to: number; still: boolean }) {
  const [v, setV] = useState(still ? to : 0);
  useEffect(() => {
    if (still) return;
    const id = setTimeout(() => setV(to), 120);
    return () => clearTimeout(id);
  }, [to, still]);
  return (
    <NumberFlow
      value={v}
      format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
      spinTiming={{ duration: 1400, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      transformTiming={{ duration: 400, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
    />
  );
}

/**
 * Runs its own loop, or, given `step`, just renders that step: the "How it works"
 * steps flow drives it one act at a time. `bare` drops the stepper and the card
 * frame, leaving just the scene to fill whatever holds it.
 */
export function HeroDemo({ step: controlled, bare = false }: { step?: number; bare?: boolean } = {}) {
  const t = useTranslations("landing.demo");
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const visible = usePageVisible();
  const reduce = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);
  const running = inView && visible && !reduce;

  useEffect(() => {
    if (!running || controlled !== undefined) return;
    const id = setTimeout(() => setStep((s) => (s === LAST ? 0 : s + 1)), TIMELINE[step]);
    return () => clearTimeout(id);
  }, [step, running, controlled]);

  const s = controlled ?? (reduce ? FINAL : step);
  const act = actOf(s);
  const months = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: "narrow" });
    return Array.from({ length: 12 }, (_, i) => f.format(new Date(2025, i, 15)));
  }, [locale]);

  const stepper = [t("steps.bills"), t("steps.questions"), t("steps.inventory"), t("steps.questionnaire")];

  return (
    <div ref={ref} role="img" aria-label={t("aria")} className={bare ? "h-full text-left" : "card p-2 text-left shadow-[var(--shadow-float)]"}>
      <div aria-hidden className={bare ? "h-full" : "rounded-[14px] border border-dashed border-line-strong"}>
        {/* Progress stepper: circles on a line that fills as the demo moves through the four acts. */}
        {!bare && <ol className="relative grid grid-cols-4 px-2 pb-4 pt-6">
          <span className="absolute left-[12.5%] right-[12.5%] top-[calc(1.5rem+15px)] h-[3px] -translate-y-1/2 rounded-full bg-sunken" />
          <span
            className="absolute left-[12.5%] right-[12.5%] top-[calc(1.5rem+15px)] h-[3px] origin-left -translate-y-1/2 rounded-full bg-signal transition-transform duration-500 ease-[var(--ease-in-out)]"
            style={{ transform: `translateY(-50%) scaleX(${act === -1 ? 1 : act / 3})` }}
          />
          {stepper.map((label, i) => {
            const done = act > i || act === -1;
            const current = act === i;
            return (
              <li key={i} className="relative flex flex-col items-center gap-2">
                <span
                  className={cn(
                    "grid size-[30px] place-items-center rounded-full text-xs font-semibold transition-colors duration-300",
                    done ? "bg-signal text-signal-on" : current ? "bg-signal text-signal-on ring-[5px] ring-signal-bg" : "bg-sunken text-muted",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn("text-[11px] transition-colors duration-300 sm:text-xs", current ? "font-medium text-signal-ink" : done ? "text-ink-soft" : "text-muted")}>{label}</span>
              </li>
            );
          })}
        </ol>}

        <div className={bare ? "relative h-full" : "relative h-[300px] px-4 py-4 sm:px-5"}>
          <AnimatePresence mode="wait" initial={false}>
            {act === 0 && (
              <Scene key="bills">
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-3">
                  <motion.span
                    animate={s <= 3 && !reduce ? { transform: ["translateY(0px)", "translateY(-3px)", "translateY(0px)"] } : { transform: "translateY(0px)" }}
                    transition={{ duration: 1, repeat: s <= 3 ? Infinity : 0, ease: "easeInOut" }}
                    className="grid size-9 place-items-center rounded-lg bg-signal-bg text-signal-ink"
                  >
                    <UploadCloud className="size-4.5" />
                  </motion.span>
                  <div>
                    <div className="text-sm font-medium">{t("drop")}</div>
                    <div className="text-xs text-muted">{t("dropSub")}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {[
                    { icon: FileImage, name: "vn_evn_2025-01.png", kind: t("electricity"), value: "42,569 kWh" },
                    { icon: FileText, name: "lpg_invoice_q2.pdf", kind: t("lpg"), value: "1,850 kg" },
                    { icon: FileImage, name: "water_2025-01.jpg", kind: t("water"), value: "312 m³" },
                  ].map((f, i) =>
                    s >= i + 1 ? (
                      <motion.li
                        key={f.name}
                        initial={reduce ? false : { opacity: 0, transform: "translateY(-10px) scale(0.97)" }}
                        animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                        transition={enter}
                        className="flex items-center gap-3 rounded-xl border hairline bg-raised px-3 py-2"
                      >
                        <f.icon className="size-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs">{f.name}</div>
                          <div className="text-[11px] text-muted">{f.kind}</div>
                        </div>
                        <AnimatePresence initial={false}>
                          {s >= 4 && (
                            <motion.span
                              initial={reduce ? false : { opacity: 0, transform: "scale(0.95)" }}
                              animate={{ opacity: 1, transform: "scale(1)" }}
                              transition={{ ...enter, delay: reduce ? 0 : i * 0.18 }}
                              className="flex items-center gap-2"
                            >
                              <span className="hidden font-mono text-xs tabular text-ink-soft sm:inline">{f.value}</span>
                              <span className="pill pill-ok"><Check className="size-3" strokeWidth={3} />{t("read")}</span>
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.li>
                    ) : (
                      <li key={f.name} className="h-[46px] rounded-xl border border-dashed hairline" />
                    ),
                  )}
                </ul>
              </Scene>
            )}

            {act === 1 && (
              <Scene key="questions">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("coverage")}</div>
                  <AnimatePresence>
                    {s >= 7 && (
                      <motion.span initial={{ opacity: 0, transform: "scale(0.95)" }} animate={{ opacity: 1, transform: "scale(1)" }} transition={enter} className="pill pill-estimated">
                        {t("estimated")}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <div className="mt-2 grid grid-cols-12 gap-1">
                  {months.map((m, i) => {
                    const gap = GAP.has(i);
                    return (
                      <div key={i} className="text-center">
                        <div className={cn("relative h-8 overflow-hidden rounded-md", gap ? "border border-dashed border-line-strong" : "bg-sunken")}>
                          {!gap && (
                            <motion.span
                              initial={reduce ? false : { transform: "scaleY(0)" }}
                              animate={{ transform: "scaleY(1)" }}
                              transition={{ duration: 0.4, delay: reduce ? 0 : 0.1 + i * 0.07, ease: EASE }}
                              className="absolute inset-0 origin-bottom bg-signal"
                            />
                          )}
                          {gap && s >= 7 && (
                            <motion.span
                              initial={reduce ? false : { transform: "scaleY(0)" }}
                              animate={{ transform: "scaleY(1)" }}
                              transition={{ duration: 0.4, delay: reduce ? 0 : 0.25 + (i - 6) * 0.1, ease: EASE }}
                              className="absolute inset-0 origin-bottom bg-attention/70"
                            />
                          )}
                        </div>
                        <div className="mt-1 text-[10px] text-muted">{m}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 space-y-2">
                  {s >= 6 && (
                    <motion.div initial={reduce ? false : { opacity: 0, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={enter} className="flex max-w-[88%] gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-signal text-signal-on"><Sparkles className="size-3" /></span>
                      <div className="rounded-2xl rounded-tl-md bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-soft">{t("ask")}</div>
                    </motion.div>
                  )}
                  {s >= 7 && (
                    <motion.div initial={reduce ? false : { opacity: 0, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={enter} className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-md bg-ink px-3 py-2 text-xs text-raised">
                      {t("reply")}
                    </motion.div>
                  )}
                </div>
              </Scene>
            )}

            {act === 2 && (
              <Scene key="inventory">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: t("scope1"), to: 94.4 },
                    { label: t("scope2"), to: 349.2 },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl border hairline bg-raised px-3 py-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.label}</div>
                      <div className="font-display text-3xl leading-tight tabular">
                        <Counter to={c.to} still={reduce} /> <span className="font-sans text-xs text-muted">tCO2e</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{t("monthly")}</div>
                <div className="mt-1.5 flex h-[72px] items-end gap-1">
                  {BARS.map((h, i) => (
                    <motion.span
                      key={i}
                      initial={reduce ? false : { transform: "scaleY(0)" }}
                      animate={{ transform: "scaleY(1)" }}
                      transition={{ duration: 0.5, delay: reduce ? 0 : 0.2 + i * 0.06, ease: EASE }}
                      style={{ height: `${h * 100}%` }}
                      className={cn("flex-1 origin-bottom rounded-t-sm", GAP.has(i) ? "bg-attention/70" : "bg-signal/80")}
                    />
                  ))}
                </div>
                {s >= 9 && (
                  <motion.div initial={reduce ? false : { opacity: 0, transform: "translateY(6px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={enter} className="mt-3 rounded-lg bg-sunken px-3 py-2">
                    <div className="text-[11px] text-muted">{t("lineage")}</div>
                    <div className="font-mono text-[11px] sm:text-xs">42,569 kWh × 0.6592 = 28.06 tCO2e</div>
                  </motion.div>
                )}
              </Scene>
            )}

            {act === 3 && (
              <Scene key="questionnaire">
                <ul className="divide-y divide-line rounded-xl border hairline">
                  {[
                    { id: "C0.2", label: t("q1"), value: "FY2025" },
                    { id: "C6.1", label: t("q2"), value: "94.4 t" },
                    { id: "C6.3", label: t("q3"), value: "349.2 t" },
                    { id: "C8.2", label: t("q4"), value: "1,212 MWh" },
                    { id: "C4.1", label: t("q5"), value: null },
                    { id: "C7.9", label: t("q6"), value: null },
                  ].map((q, i) => (
                    <li key={q.id} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                      <span className="w-9 shrink-0 font-mono text-[11px] text-muted">{q.id}</span>
                      <span className="min-w-0 flex-1 truncate">{q.label}</span>
                      <motion.span
                        initial={reduce ? false : { opacity: 0, transform: "scale(0.95)" }}
                        animate={{ opacity: 1, transform: "scale(1)" }}
                        transition={{ ...enter, delay: reduce ? 0 : 0.15 + i * 0.22 }}
                        className="flex shrink-0 items-center gap-2"
                      >
                        {q.value ? (
                          <>
                            <span className="font-mono tabular text-ink-soft">{q.value}</span>
                            <span className="grid size-4 place-items-center rounded-full bg-signal text-signal-on"><Check className="size-2.5" strokeWidth={3} /></span>
                          </>
                        ) : (
                          <span className="pill pill-attention">{t("forYou")}</span>
                        )}
                      </motion.span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex h-9 items-center justify-between gap-3">
                  <span className="text-xs text-muted">{t("filled")}</span>
                  {s >= 11 && (
                    <motion.span
                      initial={reduce ? false : { opacity: 0, transform: "scale(0.95)" }}
                      animate={{ opacity: 1, transform: "scale(1)" }}
                      transition={enter}
                      className="btn btn-sm pointer-events-none"
                    >
                      <Download className="size-3.5" />{t("download")}
                    </motion.span>
                  )}
                </div>
              </Scene>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Scene({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, transform: "translateY(10px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "translateY(-8px)" }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
