"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, FileSpreadsheet, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { api, type ReportingPeriod, type RequestView, type SupplierProfile } from "@/lib/api";

const EASE = [0.23, 1, 0.32, 1] as const;
const STEPS = ["stepWho", "stepYear", "stepDetails"] as const;
const QUESTIONS = ["qWho", "qYear", "qDetails"] as const;

// Underline fields and chips, as on the sign-in and setup pages.
const field = "w-full rounded-none border-0 border-b border-dashed border-signal/40 bg-transparent px-0 py-2.5 text-base text-ink placeholder:text-faint focus:border-solid focus:border-signal focus-visible:outline-none";
const fieldLabel = "text-xs font-medium text-signal-ink";
const chip = "min-h-9 rounded-full border px-4 text-sm transition-colors duration-150";
const chipOn = "border-signal bg-signal text-signal-on";
const chipOff = "border-signal/25 text-ink-soft hover:border-signal/60";

/**
 * A new customer request, one question at a time: who asked, for which year,
 * and the optional details (due date, their share, their Excel). Shown inline on
 * Home: always when there are no requests yet, otherwise when asked for.
 */
export function RequestFlow({
  uid,
  periods,
  profile,
  onCreated,
  onCancel,
}: {
  uid: string;
  periods: ReportingPeriod[];
  profile: SupplierProfile;
  onCreated: (v: RequestView) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("home.new");
  const toast = useToast();
  const reduce = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [share, setShare] = useState("");
  const [periodId, setPeriodId] = useState<string>(periods[0]?.id ?? "__new");
  const [start, setStart] = useState(profile.fiscal_year_start);
  const [end, setEnd] = useState(profile.fiscal_year_end);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);
  const pendingFocus = useRef(false);

  // Once the new step has slid in, its question takes focus.
  useEffect(() => {
    if (shown.current !== step) pendingFocus.current = true;
    shown.current = step;
  }, [step]);
  function settled(def: unknown) {
    if (def !== "show" || !pendingFocus.current) return;
    pendingFocus.current = false;
    heading.current?.focus();
  }

  function next(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (step === 0 && !name.trim()) { setError(t("nameRequired")); return; }
    if (step === 1 && periodId === "__new" && (!start || !end || end <= start)) { setError(t("yearOrder")); return; }
    if (step < 2) setStep(step + 1);
    else create();
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const body = {
        customer_name: name.trim(),
        due_date: due || null,
        customer_share: share.trim() ? Number(share) / 100 : null,
        ...(periodId === "__new" ? { new_period: { start, end } } : { period_id: periodId }),
      };
      let v = await api.createRequest(uid, body);
      if (file) v = await api.uploadRequestTemplate(uid, v.request.id, file);
      toast(t("created", { name: v.request.customer_name }));
      onCreated(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={next} noValidate className="rounded-[28px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_45%,var(--signal-bg)_100%)] p-6 shadow-[var(--shadow-float)] sm:p-8">
      {/* Where you are: three bars, the ones you have reached can be clicked. */}
      <div className="flex items-start justify-between gap-4">
        <ol className="grid flex-1 grid-cols-3 gap-2" aria-label={t("title")}>
          {STEPS.map((k, i) => (
            <li key={k}>
              <button type="button" className="group flex w-full flex-col items-start gap-2 text-left disabled:cursor-default" disabled={i > step || busy} aria-current={i === step ? "step" : undefined} onClick={() => { setError(""); setStep(i); }}>
                <span className={cn("block h-1 w-full rounded-full transition-colors duration-300", i <= step ? "bg-signal" : "bg-signal/15")} aria-hidden />
                <span className={cn("text-xs", i === step ? "font-medium text-ink" : i < step ? "text-ink-soft group-hover:text-ink" : "text-faint")}>{t(k)}</span>
              </button>
            </li>
          ))}
        </ol>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-2 rounded-full" aria-label={t("cancel")} onClick={onCancel} disabled={busy}>
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          variants={{
            enter: reduce ? { opacity: 0 } : { opacity: 0, transform: "translateX(16px)" },
            show: reduce ? { opacity: 1 } : { opacity: 1, transform: "translateX(0px)" },
            leave: reduce ? { opacity: 0 } : { opacity: 0, transform: "translateX(-16px)" },
          }}
          initial="enter"
          animate="show"
          exit="leave"
          transition={{ duration: 0.22, ease: EASE }}
          onAnimationComplete={settled}
          className="mt-6"
        >
          {/* Focused from code when a step arrives; no ring (the global focus rule is unlayered, so inline). */}
          <h2 ref={heading} tabIndex={-1} style={{ outline: "none" }} className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.04] text-balance text-ink">{t(QUESTIONS[step])}</h2>

          <div className="mt-7 space-y-7">
            {step === 0 && (
              <div>
                <label className={fieldLabel} htmlFor="nr-name">{t("customer")}</label>
                <input id="nr-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("customerPlaceholder")} autoComplete="off" />
              </div>
            )}

            {step === 1 && (
              <>
                <div>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("year")}>
                    {periods.map((p) => (
                      <button key={p.id} type="button" role="radio" aria-checked={periodId === p.id} className={cn(chip, periodId === p.id ? chipOn : chipOff)} onClick={() => setPeriodId(p.id)}>
                        {p.label} <span className="opacity-70">· {p.start} → {p.end}</span>
                      </button>
                    ))}
                    <button id="nr-period-new" type="button" role="radio" aria-checked={periodId === "__new"} className={cn(chip, periodId === "__new" ? chipOn : chipOff)} onClick={() => setPeriodId("__new")}>
                      {t("newYear")}
                    </button>
                  </div>
                  {periodId !== "__new" && <p className="mt-2 text-xs text-muted">{t("yearHint")}</p>}
                </div>
                {periodId === "__new" && (
                  <div className="grid gap-7 sm:grid-cols-2">
                    <div>
                      <label className={fieldLabel} htmlFor="nr-start">{t("start")}</label>
                      <input id="nr-start" className={cn(field, "tabular")} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                    </div>
                    <div>
                      <label className={fieldLabel} htmlFor="nr-end">{t("end")}</label>
                      <input id="nr-end" className={cn(field, "tabular")} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div className="grid gap-7 sm:grid-cols-2">
                  <div>
                    <label className={fieldLabel} htmlFor="nr-due">{t("due")}</label>
                    <input id="nr-due" className={cn(field, "tabular")} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="nr-share">{t("share")}</label>
                    <input id="nr-share" className={cn(field, "tabular")} inputMode="decimal" placeholder="20" value={share} onChange={(e) => setShare(e.target.value)} />
                  </div>
                </div>
                <div>
                  <p className={fieldLabel}>{t("template")}</p>
                  <input ref={pick} type="file" accept=".xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <button type="button" className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-[20px] border border-dashed border-signal/40 px-5 text-left text-sm transition-colors hover:border-signal hover:bg-signal-bg" onClick={() => pick.current?.click()}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-signal-bg text-signal-ink"><FileSpreadsheet className="size-4" aria-hidden /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-signal-ink">{file ? file.name : t("chooseTemplate")}</span>
                      <span className="block text-xs text-muted">{file ? t("changeTemplate") : t("templateOptional")}</span>
                    </span>
                  </button>
                </div>
              </>
            )}

            {error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-signal/30 pt-5">
        {step > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm -ml-2 gap-1.5 rounded-full" onClick={() => { setError(""); setStep(step - 1); }} disabled={busy}>
            <ArrowLeft className="size-4" aria-hidden />{t("back")}
          </button>
        ) : <span />}
        <button className="btn gap-1.5 rounded-full" disabled={busy}>
          {step < 2 ? <>{t("next")}<ArrowRight className="size-4" aria-hidden /></> : busy ? t("creating") : t("create")}
        </button>
      </div>
    </form>
  );
}
