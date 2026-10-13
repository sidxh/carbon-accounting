"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { api, type ReportingPeriod, type RequestView, type SupplierProfile } from "@/lib/api";

// Underline fields and chips, as on the sign-in and setup pages. Text starts a little
// in from the underline's start, and labels line up with it.
const field = "w-full rounded-none border-0 border-b border-dashed border-signal/40 bg-transparent px-3 py-2.5 text-base text-ink placeholder:text-faint focus:border-solid focus:border-signal focus-visible:outline-none";
const fieldLabel = "px-3 text-xs font-medium text-signal-ink";
const chip = "min-h-9 rounded-full border px-4 text-sm transition-colors duration-150";
const chipOn = "border-signal bg-signal text-signal-on";
const chipOff = "border-signal/25 text-ink-soft hover:border-signal/60";

/**
 * A new customer request on one form: who asked, for which year, then the optional
 * details (due date, their share, their Excel). Inline on Home as the first request
 * (`variant="card"`), otherwise inside the New request dialog (`variant="plain"`).
 */
export function RequestFlow({
  uid,
  periods,
  profile,
  onCreated,
  onCancel,
  variant = "card",
}: {
  uid: string;
  periods: ReportingPeriod[];
  profile: SupplierProfile;
  onCreated: (v: RequestView) => void;
  onCancel?: () => void;
  variant?: "card" | "plain";
}) {
  const t = useTranslations("home.new");
  const toast = useToast();
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError(t("nameRequired")); return; }
    if (periodId === "__new" && (!start || !end || end <= start)) { setError(t("yearOrder")); return; }
    setBusy(true);
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
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="nr-title"
      className={cn(variant === "card" && "rounded-[28px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_45%,var(--signal-bg)_100%)] p-6 shadow-[var(--shadow-float)] sm:p-8")}
    >
      {variant === "card" && <h2 id="nr-title" className="font-display text-[clamp(1.9rem,3.6vw,2.5rem)] leading-[1.04] text-balance text-ink">{t("qWho")}</h2>}

      <div className={cn("space-y-7", variant === "card" && "mt-7")}>
        <div>
          <label className={fieldLabel} htmlFor="nr-name">{t("customer")}</label>
          <input id="nr-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("customerPlaceholder")} autoComplete="off" autoFocus={variant === "plain"} />
        </div>

        <div>
          <p className={fieldLabel}>{t("year")}</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t("year")}>
            {periods.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={periodId === p.id} className={cn(chip, periodId === p.id ? chipOn : chipOff)} onClick={() => setPeriodId(p.id)}>
                {p.label} <span className="opacity-70">· {p.start} → {p.end}</span>
              </button>
            ))}
            <button id="nr-period-new" type="button" role="radio" aria-checked={periodId === "__new"} className={cn(chip, periodId === "__new" ? chipOn : chipOff)} onClick={() => setPeriodId("__new")}>
              {t("newYear")}
            </button>
          </div>
          {periodId !== "__new" ? (
            <p className="mt-2 px-3 text-xs text-muted">{t("yearHint")}</p>
          ) : (
            <div className="mt-5 grid gap-7 sm:grid-cols-2">
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
        </div>

        {/* The optional details, set apart so the two required answers come first. */}
        <div className="space-y-7 border-t border-dashed border-signal/30 pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("optional")}</p>
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
        </div>

        {error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-end gap-2">
        {onCancel && <button type="button" className="btn btn-ghost rounded-full" onClick={onCancel} disabled={busy}>{t("cancel")}</button>}
        <button className="btn rounded-full" disabled={busy}>{busy ? t("creating") : t("create")}</button>
      </div>
    </form>
  );
}
