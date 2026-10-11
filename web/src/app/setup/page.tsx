"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { RequireAuth } from "@/components/require-auth";
import { Landscape } from "@/components/landing/landscape";
import { Shell } from "@/components/shell";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type SupplierProfile } from "@/lib/api";

const COUNTRIES = ["VN", "JP", "SG", "AU", "TH", "ID", "IN"];
const LANGS = [["vi", "Tiếng Việt"], ["ja", "日本語"], ["en", "English"]] as const;

const CURRENCY: Record<string, string> = { VN: "VND", JP: "JPY", SG: "SGD", AU: "AUD", TH: "THB", ID: "IDR", IN: "INR" };
const STEP_KEYS = ["stepCompany", "stepYear", "stepSites", "stepExtras"] as const;
const QUESTIONS = ["qCompany", "qYear", "qSites", "qExtras"] as const;
const EASE = [0.23, 1, 0.32, 1] as const;

// Underline fields, as on the sign-in page.
const field = "w-full rounded-none border-0 border-b border-dashed border-signal/40 bg-transparent px-0 py-2.5 text-base text-ink placeholder:text-faint focus:border-solid focus:border-signal focus-visible:outline-none";
const fieldLabel = "text-xs font-medium text-signal-ink";
const chip = "min-h-9 rounded-full border px-4 text-sm transition-colors duration-150";

/**
 * Setup, one question at a time: company, reporting year, sites, then the
 * optional extras.
 * Returning suppliers can jump to any step and save from any of them.
 */
function Form({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("setup");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion() ?? false;
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(profile ? 3 : 0);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);
  const pendingFocus = useRef(false);
  const rail = useRef<HTMLElement>(null);
  const [f, setF] = useState({
    name: profile?.name ?? "",
    country: profile?.country ?? "VN",
    language: profile?.language ?? locale,
    fiscal_year_start: profile?.fiscal_year_start ?? "2025-01-01",
    fiscal_year_end: profile?.fiscal_year_end ?? "2025-12-31",
    sites: profile?.sites.map((s) => ({ name: s.name, country: s.country, region: s.region ?? "", address: s.address ?? "" })) ?? [{ name: "", country: profile?.country ?? "VN", region: "", address: "" }],
    sector: profile?.sector ?? "",
    revenue: profile?.revenue?.toString() ?? "",
    revenue_currency: profile?.revenue_currency ?? "",
  });

  // Once the new step has slid in, its question takes focus (so screen readers
  // hear where they are), and the page scrolls back up to it if you were below.
  useEffect(() => {
    if (shown.current !== step) pendingFocus.current = true;
    shown.current = step;
  }, [step]);
  function settled(def: unknown) {
    if (def !== "show" || !pendingFocus.current) return;
    pendingFocus.current = false;
    heading.current?.focus({ preventScroll: true });
    if ((rail.current?.getBoundingClientRect().top ?? 0) < 0) rail.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  /** The first step that is not complete yet, with what is wrong, or null. */
  function problem(): [number, string] | null {
    if (!f.name.trim()) return [0, t("nameRequired")];
    if (!f.fiscal_year_start || !f.fiscal_year_end || f.fiscal_year_end <= f.fiscal_year_start) return [1, t("yearOrder")];
    return null;
  }

  function go(n: number) {
    setError("");
    setStep(n);
    setReached((r) => Math.max(r, n));
  }

  function next(e: React.FormEvent) {
    e.preventDefault();
    const p = problem();
    if (p && p[0] <= step) {
      setError(p[1]);
      if (p[0] < step) setStep(p[0]);
      return;
    }
    if (step < 3) go(step + 1);
    else save();
  }

  async function save() {
    const p = problem();
    if (p) {
      setStep(p[0]);
      setError(p[1]);
      return;
    }
    setBusy(true);
    try {
      await api.upsertSupplier({
        name: f.name,
        country: f.country,
        language: f.language,
        fiscal_year_start: f.fiscal_year_start,
        fiscal_year_end: f.fiscal_year_end,
        sector: f.sector,
        revenue: f.revenue ? Number(f.revenue) : null,
        revenue_currency: f.revenue_currency || null,
        sites: f.sites.filter((s) => s.name.trim()).map((s) => ({ name: s.name, country: s.country || f.country, region: s.region || null, address: s.address.trim() || null })),
      });
      toast(t("saved"));
      router.push("/home");
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    setBusy(true);
    try {
      await api.resetAll(uid);
      toast(t("startedOver"));
      router.push("/home");
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  const setSite = (i: number, patch: Partial<(typeof f.sites)[number]>) => {
    const sites = [...f.sites];
    sites[i] = { ...sites[i], ...patch };
    setF({ ...f, sites });
  };

  // Reporting-year presets: the last calendar year, this one, and April to March.
  const y = new Date().getFullYear();
  const presets = [
    { label: t("presetCalendar", { year: y - 1 }), start: `${y - 1}-01-01`, end: `${y - 1}-12-31` },
    { label: t("presetCalendar", { year: y }), start: `${y}-01-01`, end: `${y}-12-31` },
    { label: t("presetFiscal", { a: y - 1, b: y }), start: `${y - 1}-04-01`, end: `${y}-03-31` },
  ];

  return (
    <div className="relative z-10 space-y-8 pb-[22dvh]">
      <div>
        <p className="inline-flex items-center gap-2 rounded-full border border-signal/20 bg-signal-bg px-4 py-1.5 text-sm font-medium text-signal-ink">
          <span className="size-2 rounded-full bg-attention-strong" aria-hidden />{t("title")}
        </p>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-pretty text-ink-soft">{t("lede")}</p>
      </div>

      {/* Where you are: four dots on a line; the ones you have reached can be clicked. */}
      <nav ref={rail} aria-label={t("title")} className="scroll-mt-4">
        <p className="mb-3 font-mono text-xs text-signal-ink">{t("stepOf", { n: step + 1, total: 4 })}</p>
        <ol className="grid grid-cols-4 gap-2">
          {STEP_KEYS.map((k, i) => {
            const done = i < step, on = i === step;
            return (
              <li key={k}>
                <button
                  type="button"
                  className="group flex w-full flex-col items-start gap-2 text-left disabled:cursor-default"
                  disabled={i > reached || busy}
                  aria-current={on ? "step" : undefined}
                  onClick={() => go(i)}
                >
                  <span className={cn("block h-1 w-full rounded-full transition-colors duration-300", done || on ? "bg-signal" : "bg-signal/15")} aria-hidden />
                  <span className={cn("text-xs sm:text-sm", on ? "font-medium text-ink" : i <= reached ? "text-ink-soft group-hover:text-ink" : "text-faint")}>{t(k)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form onSubmit={next} noValidate className="rounded-[28px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_45%,var(--signal-bg)_100%)] p-6 shadow-[var(--shadow-float)] sm:p-8">
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
          >
            {/* Focused from code when a step arrives; no ring (the global focus rule is unlayered, so inline). */}
            <h1 ref={heading} tabIndex={-1} style={{ outline: "none" }} className="font-display text-[clamp(2rem,4vw,3rem)] leading-[1.02] text-balance text-ink">{t(QUESTIONS[step])}</h1>

            <div className="mt-8 space-y-7">
              {step === 0 && (
                <>
                  <div>
                    <label className={fieldLabel} htmlFor="name">{t("name")}</label>
                    <input id="name" className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="organization" autoFocus={!profile} />
                  </div>
                  <div className="grid gap-7 sm:grid-cols-[160px_1fr]">
                    <div>
                      <label className={fieldLabel} htmlFor="country">{t("country")}</label>
                      <select id="country" className={cn(field, "cursor-pointer")} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                        {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <fieldset aria-describedby="language-hint">
                      <legend className={fieldLabel}>{t("language")}</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {LANGS.map(([k, v]) => (
                          <label key={k} className={cn(chip, "inline-flex cursor-pointer items-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal", f.language === k ? "border-signal bg-signal text-signal-on" : "border-signal/25 text-ink-soft hover:border-signal/60")}>
                            <input type="radio" name="language" value={k} id={`language-${k}`} className="sr-only" checked={f.language === k} onChange={() => setF({ ...f, language: k })} />
                            <span lang={k}>{v}</span>
                          </label>
                        ))}
                      </div>
                      <p id="language-hint" className="mt-2 text-xs text-muted">{t("languageHint")}</p>
                    </fieldset>
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {presets.map((p) => {
                      const on = f.fiscal_year_start === p.start && f.fiscal_year_end === p.end;
                      return (
                        <button key={p.label} type="button" aria-pressed={on} className={cn(chip, on ? "border-signal bg-signal text-signal-on" : "border-signal/25 text-ink-soft hover:border-signal/60")} onClick={() => setF({ ...f, fiscal_year_start: p.start, fiscal_year_end: p.end })}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="font-mono text-xs text-signal-ink">↳ {t("customDates")}</p>
                  <div className="grid gap-7 sm:grid-cols-2">
                    <div>
                      <label className={fieldLabel} htmlFor="fyStart">{t("fyStart")}</label>
                      <input id="fyStart" className={cn(field, "tabular")} type="date" value={f.fiscal_year_start} onChange={(e) => setF({ ...f, fiscal_year_start: e.target.value })} />
                    </div>
                    <div>
                      <label className={fieldLabel} htmlFor="fyEnd">{t("fyEnd")}</label>
                      <input id="fyEnd" className={cn(field, "tabular")} type="date" value={f.fiscal_year_end} onChange={(e) => setF({ ...f, fiscal_year_end: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <div>
                  <p className="text-sm text-muted">{t("sitesHint")}</p>
                  <ul className="mt-4 grid gap-3">
                    {f.sites.map((s, i) => (
                      <li key={i} className="rounded-[20px] border border-signal/15 bg-raised p-5">
                        <div className="flex items-start gap-3">
                          <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-2">
                            <div>
                              <label className={fieldLabel} htmlFor={`site-name-${i}`}>{t("siteName")}</label>
                              <input id={`site-name-${i}`} className={field} value={s.name} onChange={(e) => setSite(i, { name: e.target.value })} />
                            </div>
                            <div>
                              <label className={fieldLabel} htmlFor={`site-region-${i}`}>{t("siteRegion")}</label>
                              <input id={`site-region-${i}`} className={field} value={s.region} onChange={(e) => setSite(i, { region: e.target.value })} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={fieldLabel} htmlFor={`site-address-${i}`}>{t("siteAddress")}</label>
                              <input id={`site-address-${i}`} className={field} value={s.address} onChange={(e) => setSite(i, { address: e.target.value })} autoComplete="street-address" />
                            </div>
                          </div>
                          <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-2 rounded-full" aria-label={t("removeSite", { n: i + 1 })} disabled={f.sites.length === 1} onClick={() => setF({ ...f, sites: f.sites.filter((_, j) => j !== i) })}>
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      </li>
                    ))}
                    <li>
                      <button type="button" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[20px] border border-dashed border-signal/40 text-sm font-medium text-signal-ink transition-colors hover:border-signal hover:bg-signal-bg" onClick={() => setF({ ...f, sites: [...f.sites, { name: "", country: f.country, region: "", address: "" }] })}>
                        <Plus className="size-4" aria-hidden />{t("addSiteCard")}
                      </button>
                    </li>
                  </ul>
                </div>
              )}

              {step === 3 && (
                <div className="grid gap-7 sm:grid-cols-[1fr_140px]">
                  <div>
                    <label className={fieldLabel} htmlFor="revenue">{t("revenue")}</label>
                    <input id="revenue" className={cn(field, "tabular")} inputMode="decimal" value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="currency">{t("currency")}</label>
                    <input id="currency" className={field} placeholder={CURRENCY[f.country] ?? "USD"} value={f.revenue_currency} onChange={(e) => setF({ ...f, revenue_currency: e.target.value.toUpperCase() })} />
                  </div>
                </div>
              )}

              {error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-signal/30 pt-5">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm -ml-2 gap-1.5 rounded-full" onClick={() => go(step - 1)} disabled={busy}>
              <ArrowLeft className="size-4" aria-hidden />{t("back")}
            </button>
          ) : <span />}
          <div className="flex flex-wrap items-center gap-2">
            {step === 3 && !f.revenue && (
              <button type="button" className="btn btn-ghost btn-sm rounded-full" onClick={save} disabled={busy}>{t("skip")}</button>
            )}
            {profile && step < 3 && (
              <button type="button" className="btn btn-secondary rounded-full" onClick={save} disabled={busy}>{t("saveNow")}</button>
            )}
            <button className="btn gap-1.5 rounded-full" disabled={busy}>
              {step < 3 ? <>{t("next")}<ArrowRight className="size-4" aria-hidden /></> : t("save")}
            </button>
          </div>
        </div>
      </form>

      {profile && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-dashed border-danger/30 bg-raised p-5 text-sm">
          <div>
            <div className="font-medium">{t("startOver")}</div>
            <div className="mt-0.5 text-muted">{t("startOverLede")}</div>
          </div>
          <button type="button" className="btn btn-danger btn-sm rounded-full" onClick={() => setConfirmReset(true)} disabled={busy}>{t("startOver")}</button>
        </div>
      )}

      <Dialog
        open={confirmReset}
        title={t("startOver")}
        description={t("startOverConfirm")}
        confirmLabel={t("startOver")}
        cancelLabel={t("cancel")}
        tone="danger"
        busy={busy}
        onConfirm={startOver}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

export default function SetupPage() {
  return (
    <Shell>
      {/* The landing footer's landscape, held at the foot of the screen behind the whole page. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-0" aria-hidden>
        {/* Cropped from the top of the drawing (not the footer's y=60), so the ridges and the tree's crown are whole. */}
        <Landscape viewBox="0 0 1440 420" className="block h-[40dvh] w-full sm:h-[46dvh]" />
      </div>
      <RequireAuth>{(profile, uid) => <Form profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
