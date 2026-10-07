"use client";

import { AnimatePresence, motion, type Easing } from "motion/react";
import NumberFlow from "@number-flow/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { AlertTriangle, Check, Download, FileSpreadsheet, Link2, Loader2, MessageCircleQuestion, ScanLine } from "lucide-react";
import { cn } from "@/lib/cn";

// The two scenes of the steps flow that the product demo does not already draw.
// Each is a pure picture of its `phase`; the flow's clock moves the phase on.

const EASE = [0.23, 1, 0.32, 1] as const;
const enter = { duration: 0.35, ease: EASE };

/** Phase lengths (ms). Upload: bills wait above the folder, drop in one by one, reading, done. */
export const UPLOAD_PHASES = [900, 900, 900, 900, 1400, 2000];

const FILES = [
  { kind: "JPG", name: "vn_evn_2025-01.jpg" },
  { kind: "PDF", name: "lpg_invoice_q2.pdf" },
  { kind: "JPG", name: "diesel_slip_0412.jpg" },
];
const PER_FILE = 4; // bills each file stands for in the counter

// Geometry (px) of the stage: the queue of bills sits above the folder.
const QUEUE_H = 104; // room above the folder for the waiting bills
const FOLDER_H = 150;
const FRONT_TOP = QUEUE_H + 62; // where the folder's see-through front starts
// Waiting: stacked above the folder, the next to drop at the bottom of the stack.
const QUEUED = [44, 24, 4];
// Landed: on the pile inside the folder, each a little higher than the one before.
const REST = [
  { y: QUEUE_H + 30, x: -8, r: -3 },
  { y: QUEUE_H + 20, x: 8, r: 2.5 },
  { y: QUEUE_H + 10, x: -2, r: -1 },
];
// The drop: a small lift, then a fall that speeds up (gravity), a bounce, settle.
const DROP_TIMES = [0, 0.16, 0.7, 0.85, 1];
const DROP_EASE: Easing[] = [[0.23, 1, 0.32, 1], [0.55, 0, 1, 0.45], [0, 0.55, 0.45, 1], [0.55, 0, 1, 0.45]];

/** A bill as a landscape sheet: folded corner, a few lines of text, a file-type badge. */
function Paper({ kind }: { kind: string }) {
  return (
    <span className="relative block h-[72px] w-[124px] overflow-hidden rounded-[10px] border hairline bg-raised shadow-[var(--shadow-float)]">
      <span className="absolute right-0 top-0 size-4 rounded-bl-[7px] border-b border-l hairline bg-sunken" />
      <span className="absolute left-3 top-3 block h-1.5 w-12 rounded-full bg-line-strong" />
      <span className="absolute left-3 top-6 block h-1 w-20 rounded-full bg-line" />
      <span className="absolute left-3 top-8 block h-1 w-16 rounded-full bg-line" />
      <span className="absolute left-3 top-10 block h-1 w-[92px] rounded-full bg-line" />
      <span className="absolute bottom-2 left-3 rounded-[5px] bg-signal px-1.5 py-0.5 font-mono text-[9px] font-semibold text-signal-on">{kind}</span>
      <span className="absolute bottom-2.5 right-3 block h-1 w-7 rounded-full bg-line-strong" />
    </span>
  );
}

/**
 * Bills dropped into a folder one at a time, as in a file-import animation. The
 * three bills wait in a stack directly above the folder; one by one the lowest
 * lifts a touch, then falls in under gravity (speeding up, with a small bounce)
 * onto the pile behind the folder's see-through front, where it stays visible as
 * a silhouette. The folder nudges and its count climbs. Then the bills are read
 * and the scene settles on a tick.
 */
export function UploadScene({ phase }: { phase: number }) {
  const t = useTranslations("landing.flow");
  const dropping = phase >= 1 && phase <= FILES.length ? phase - 1 : -1; // the bill falling now
  const landed = Math.min(Math.max(phase - 1, 0), FILES.length); // bills already in the folder
  const count = landed * PER_FILE;
  return (
    <div className="relative flex h-full flex-col items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {phase < 5 ? (
          <motion.div key="work" exit={{ opacity: 0, transition: { duration: 0.2 } }} className="flex flex-col items-center gap-3">
            <div className="relative w-56" style={{ height: QUEUE_H + FOLDER_H }}>
              {/* Back of the folder and its tab. */}
              <span className="absolute left-0 h-8 w-[88px] rounded-t-[16px] bg-signal-ink" style={{ top: QUEUE_H }} />
              <span className="absolute inset-x-0 bottom-0 rounded-[20px] rounded-tl-none bg-signal-ink" style={{ top: QUEUE_H + 18 }} />

              {/* The bills: waiting above, falling, or landed on the pile. */}
              {FILES.map((f, k) => {
                const isLanded = k < landed;
                const isDropping = k === dropping;
                const from = QUEUED[k];
                const to = REST[k].y;
                return (
                  <motion.span
                    key={k}
                    className="absolute left-1/2 top-0 -ml-[62px]"
                    initial={false}
                    animate={
                      isDropping
                        ? { y: [from, from - 8, to, to - 8, to], x: [0, 0, REST[k].x, REST[k].x, REST[k].x], rotate: [0, 0, REST[k].r, REST[k].r, REST[k].r] }
                        : isLanded
                          ? { y: to, x: REST[k].x, rotate: REST[k].r }
                          : { y: from, x: 0, rotate: 0 }
                    }
                    transition={isDropping ? { duration: 0.75, times: DROP_TIMES, ease: DROP_EASE } : { duration: 0 }}
                  >
                    <Paper kind={f.kind} />
                  </motion.span>
                );
              })}

              {/* The see-through front, with the count. It nudges as each bill lands. */}
              <motion.span
                key={count}
                initial={count ? { transform: "translateY(4px)" } : false}
                animate={{ transform: "translateY(0px)" }}
                transition={{ duration: 0.3, ease: EASE }}
                className="absolute inset-x-0 bottom-0 flex flex-col justify-end rounded-[20px] border border-signal-on/25 bg-signal/75 px-5 pb-3.5 text-signal-on"
                style={{ top: FRONT_TOP }}
              >
                <span className="text-xs opacity-85">{t("upload.read")}</span>
                <span className="font-display text-4xl leading-none">
                  <NumberFlow value={count} /> <span className="font-sans text-sm">{t("upload.bills")}</span>
                </span>
              </motion.span>
            </div>
            <div className="h-9 text-center">
              {phase < 4 ? (
                <>
                  <div className="text-sm font-medium text-ink">{dropping >= 0 ? FILES[dropping].name : t("upload.drop")}</div>
                  <div className="text-xs text-muted">{t("upload.dropSub")}</div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Loader2 className="size-4 animate-spin text-signal" aria-hidden />{t("upload.reading")}
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="done" initial={{ opacity: 0, transform: "scale(0.95)" }} animate={{ opacity: 1, transform: "scale(1)" }} transition={enter} className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-signal text-signal-on"><Check className="size-8" strokeWidth={2.5} /></span>
            <div className="font-display text-3xl text-ink">{t("upload.done")}</div>
            <div className="text-sm text-muted">{t("upload.doneSub")}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Phase lengths (ms). Scan: doc in, beam sweeps, fields fill, gap found, question, answer, resolved. */
export const SCAN_PHASES = [400, 1600, 1400, 900, 1500, 700, 1900];

/** A bill is scanned, its fields fill in, a missing month is flagged and asked about. */
export function ScanScene({ phase }: { phase: number }) {
  const t = useTranslations("landing.flow.scan");
  const scanned = phase >= 2;
  const fields = [
    { k: t("period"), v: "01/2025" },
    { k: t("energy"), v: t("electricity") },
    { k: t("quantity"), v: "42,569 kWh" },
    { k: t("site"), v: "Biên Hòa" },
  ];
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-[0.95fr_1fr] gap-3">
        {/* The bill, with the scanning beam passing over it. */}
        <div className="relative">
          <span className={cn("absolute -top-2.5 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", scanned ? "bg-signal text-signal-on" : "bg-raised text-signal-ink shadow-[var(--shadow-raised)]")}>
            {scanned ? <Check className="size-3" strokeWidth={3} /> : <ScanLine className="size-3" />}
            {scanned ? t("done") : t("scanning")}
          </span>
          <div className="relative h-[184px] overflow-hidden rounded-[18px] border hairline bg-raised p-3.5 pt-5 font-mono text-[11px] leading-relaxed text-ink-soft">
            <div className="flex items-baseline justify-between"><span className="font-sans text-[13px] font-bold text-ink">EVN HCMC</span><span>01/2025</span></div>
            <div className="mb-2 text-[9.5px] uppercase text-muted">Hóa đơn tiền điện</div>
            <div className="flex justify-between"><span>Điện năng</span><span>42.569 kWh</span></div>
            <div className="flex justify-between"><span>Đơn giá</span><span>2.312 ₫</span></div>
            <div className="flex justify-between"><span>Tiền điện</span><span>98.419.528 ₫</span></div>
            <div className="mt-2 space-y-1">
              <span className="block h-1 w-full rounded bg-sunken" /><span className="block h-1 w-4/5 rounded bg-sunken" /><span className="block h-1 w-3/5 rounded bg-sunken" />
            </div>
            {phase >= 1 && !scanned && (
              <motion.span
                aria-hidden
                initial={{ transform: "translateY(-40px)" }}
                animate={{ transform: "translateY(196px)" }}
                transition={{ duration: 1.5, ease: "linear" }}
                className="absolute inset-x-0 top-0 h-9 border-b-2 border-signal bg-signal/15"
              />
            )}
          </div>
        </div>

        {/* What was read off it. */}
        <ul className="flex flex-col justify-center gap-2">
          {fields.map((f, i) => (
            <li key={f.k} className="flex h-[38px] items-center justify-between gap-2 rounded-full border hairline bg-raised px-3.5 text-xs">
              <span className="text-muted">{f.k}</span>
              {scanned ? (
                <motion.span initial={{ opacity: 0, transform: "translateY(4px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ ...enter, delay: i * 0.22 }} className="flex items-center gap-1 font-medium text-ink">
                  {f.v}<Check className="size-3 text-signal" strokeWidth={3} />
                </motion.span>
              ) : (
                <span className="h-2 w-14 rounded-full bg-sunken" />
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* The gap, the question about it, and the answer. */}
      <div className="flex flex-1 flex-col gap-2">
        {phase >= 3 && (
          <motion.div
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={enter}
            className={cn("flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors duration-500", phase >= 6 ? "bg-signal-bg text-signal-ink" : "bg-attention-bg text-attention")}
          >
            {phase >= 6 ? <Check className="size-3.5" strokeWidth={3} /> : <AlertTriangle className="size-3.5" />}
            {phase >= 6 ? t("resolved") : t("gap")}
          </motion.div>
        )}
        {phase >= 4 && phase < 6 && (
          <motion.div initial={{ opacity: 0, transform: "translateY(6px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={enter} className="flex flex-col gap-2">
            <div className="flex items-start gap-2 text-sm text-ink">
              <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-signal" />{t("ask")}
            </div>
            <div className="flex flex-wrap gap-1.5 pl-6">
              <span className={cn("rounded-full border px-3 py-1 text-xs transition-colors duration-300", phase >= 5 ? "border-signal bg-signal text-signal-on" : "border-line-strong text-ink-soft")}>{t("yes")}</span>
              <span className={cn("rounded-full border border-line-strong px-3 py-1 text-xs text-ink-soft transition-opacity duration-300", phase >= 5 && "opacity-40")}>{t("no")}</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Phase lengths (ms). Inventory: bars grow, totals count, the ring draws, a line is traced, hold. */
export const INVENTORY_PHASES = [1100, 1300, 1700, 1600];

const S1 = 94.4;
const S2 = 349.2;
const MONTHS = [0.62, 0.58, 0.66, 0.71, 0.84, 0.93, 1, 0.96, 0.82, 0.7, 0.64, 0.68];

/**
 * The inventory, built in front of you: twelve monthly bars grow one after another,
 * the year's total counts up beside a ring that splits it into Scope 1 and 2, and
 * then one bar is traced back to the bill and factor behind it.
 */
export function InventoryScene({ phase }: { phase: number }) {
  const t = useTranslations("landing.flow.inv");
  const locale = useLocale();
  const months = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: "narrow" });
    return MONTHS.map((_, i) => f.format(new Date(2025, i, 15)));
  }, [locale]);
  const counted = phase >= 1;
  const s1Share = S1 / (S1 + S2);
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted">{t("total")}</div>
          <div className="font-display text-[3.4rem] leading-none text-ink">
            <NumberFlow value={counted ? S1 + S2 : 0} locales={locale} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
            <span className="ml-1.5 font-sans text-base text-muted">tCO₂e</span>
          </div>
          <div className="mt-2 flex gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-ink-soft"><span className="size-2 rounded-full bg-signal-ink" />Scope 1 <b className="font-mono font-medium text-ink"><NumberFlow value={counted ? S1 : 0} locales={locale} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></b></span>
            <span className="flex items-center gap-1.5 text-ink-soft"><span className="size-2 rounded-full bg-signal/45" />Scope 2 <b className="font-mono font-medium text-ink"><NumberFlow value={counted ? S2 : 0} locales={locale} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></b></span>
          </div>
        </div>
        {/* Scope split ring: Scope 2 draws first, Scope 1 sweeps in over it. */}
        <svg viewBox="0 0 80 80" className="size-24 shrink-0 -rotate-90" aria-hidden>
          <circle cx={40} cy={40} r={30} fill="none" stroke="var(--sunken)" strokeWidth={12} />
          <motion.circle
            cx={40} cy={40} r={30} fill="none" stroke="var(--signal)" strokeOpacity={0.45} strokeWidth={12}
            initial={false} animate={{ pathLength: counted ? 1 : 0 }} transition={{ duration: 0.9, ease: EASE }}
          />
          <motion.circle
            cx={40} cy={40} r={30} fill="none" stroke="var(--signal-ink)" strokeWidth={12} strokeLinecap="butt"
            initial={false} animate={{ pathLength: phase >= 2 ? s1Share : 0 }} transition={{ duration: 0.7, ease: EASE }}
          />
        </svg>
      </div>

      {/* Monthly bars, growing in turn. January is the one traced below. */}
      <div className="flex flex-1 items-end gap-1.5">
        {MONTHS.map((h, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <motion.span
              className={cn("block w-full origin-bottom rounded-t-[6px] transition-colors duration-500", phase >= 3 && i === 0 ? "bg-signal-ink" : phase >= 3 ? "bg-signal/35" : "bg-signal")}
              style={{ height: `${h * 100}%` }}
              initial={{ transform: "scaleY(0)" }}
              animate={{ transform: "scaleY(1)" }}
              transition={{ duration: 0.5, delay: i * 0.05, ease: EASE }}
            />
            <span className={cn("text-[10px]", phase >= 3 && i === 0 ? "font-semibold text-signal-ink" : "text-muted")}>{months[i]}</span>
          </div>
        ))}
      </div>

      <div className="h-11">
        {phase >= 3 && (
          <motion.div
            initial={{ opacity: 0, transform: "translateY(8px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={enter}
            className="flex h-full items-center gap-2 rounded-full bg-signal px-4 text-xs text-signal-on"
          >
            <Link2 className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t("trace")}</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Phase lengths (ms). Questionnaire: sheet in, six answers fill, the two for you flag, ready, hold. */
export const FORM_PHASES = [450, 1700, 700, 2400];

const ANSWERS = [
  { code: "C0.2", q: "q1", a: "FY2025" },
  { code: "C6.1", q: "q2", a: "94.4 t" },
  { code: "C6.3", q: "q3", a: "349.2 t" },
  { code: "C8.2", q: "q4", a: "1,212 MWh" },
  { code: "C4.1", q: "q5", a: null },
  { code: "C7.9", q: "q6", a: null },
] as const;

/**
 * The customer's own sheet, answered: cells fill one by one from the inventory with
 * a green flash and a tick, the two only the supplier can answer are flagged, then
 * a "ready to send" stamp lands next to the filled file.
 */
export function FormScene({ phase }: { phase: number }) {
  const t = useTranslations("landing.flow.form");
  const d = useTranslations("landing.demo");
  const filling = phase >= 1;
  const answered = phase >= 1 ? 4 : 0;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="grid size-8 place-items-center rounded-[10px] bg-signal-bg text-signal-ink"><FileSpreadsheet className="size-4" /></span>
          {t("title")}
        </span>
        <span className="font-mono text-xs text-muted">
          <NumberFlow value={answered} /> / 6 {t("answered")}
        </span>
      </div>

      <ul className="overflow-hidden rounded-[18px] border hairline bg-raised">
        {ANSWERS.map((r, i) => {
          const delay = 0.15 + i * 0.25;
          return (
            <li key={r.code} className="relative flex h-[38px] items-center gap-3 border-b hairline px-3.5 text-xs last:border-b-0">
              {/* The green flash as a cell is written. */}
              {filling && r.a && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 bg-signal-bg"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0.35] }}
                  transition={{ duration: 0.6, delay, times: [0, 0.3, 1] }}
                />
              )}
              <span className="relative w-9 font-mono text-[10px] text-muted">{r.code}</span>
              <span className="relative flex-1 truncate text-ink-soft">{d(r.q)}</span>
              <span className="relative flex items-center gap-1.5">
                {r.a ? (
                  filling && (
                    <motion.span initial={{ opacity: 0, transform: "translateX(-8px)" }} animate={{ opacity: 1, transform: "translateX(0px)" }} transition={{ ...enter, delay }} className="flex items-center gap-1.5 font-mono font-medium text-ink">
                      {r.a}
                      <span className="grid size-4 place-items-center rounded-full bg-signal text-signal-on"><Check className="size-2.5" strokeWidth={3.5} /></span>
                    </motion.span>
                  )
                ) : (
                  phase >= 2 && (
                    <motion.span initial={{ opacity: 0, transform: "scale(0.95)" }} animate={{ opacity: 1, transform: "scale(1)" }} transition={enter} className="pill pill-attention">
                      {d("forYou")}
                    </motion.span>
                  )
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="relative flex flex-1 items-center justify-between gap-3">
        {phase >= 3 && (
          <>
            <motion.span
              initial={{ opacity: 0, transform: "rotate(-14deg) scale(1.3)" }}
              animate={{ opacity: 1, transform: "rotate(-6deg) scale(1)" }}
              transition={{ duration: 0.4, ease: EASE }}
              className="rounded-[10px] border-2 border-signal px-3 py-1 font-display text-xl text-signal"
            >
              {t("ready")}
            </motion.span>
            <motion.span
              initial={{ opacity: 0, transform: "translateY(8px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={{ ...enter, delay: 0.25 }}
              className="btn btn-sm pointer-events-none"
            >
              <Download className="size-3.5" />{t("file")}
            </motion.span>
          </>
        )}
      </div>
    </div>
  );
}
