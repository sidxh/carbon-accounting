"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight, BookOpenCheck, CalendarDays, FileSpreadsheet, Link2, Plus, ShieldCheck, Trash2, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { RequireAuth } from "@/components/require-auth";
import { Shell, nextStep } from "@/components/shell";
import { CoverageStrip, EmptyState, PageTitle, SkeletonList } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type HomeView, type PeriodView, type ReportingPeriod, type RequestView, type SupplierProfile } from "@/lib/api";
import { energyLabel, shortMonth } from "@/lib/coverage";

const t1 = (kg: number) => (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
const SEGMENTS = ["bills", "questions", "inventory", "filled"] as const;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

function dueTone(due: string | null | undefined): "overdue" | "soon" | "ok" | null {
  if (!due) return null;
  const days = Math.ceil((new Date(due + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  return days < 0 ? "overdue" : days <= 14 ? "soon" : "ok";
}

/** Four segments: Bills → Questions → Inventory → Filled. */
function ProgressBar({ view }: { view: RequestView }) {
  const t = useTranslations("home");
  const done = { bills: view.progress.bills, questions: view.progress.questions, inventory: view.progress.inventory, filled: view.status === "filled" };
  return (
    <div className="flex gap-1" role="img" aria-label={SEGMENTS.map((k) => `${t(`seg.${k}`)}: ${done[k] ? t("done") : t("todo")}`).join(", ")}>
      {SEGMENTS.map((k) => (
        <span key={k} className={cn("h-1.5 flex-1 rounded-full", done[k] ? "bg-signal" : "bg-sunken")} title={t(`seg.${k}`)} />
      ))}
    </div>
  );
}

function RequestCard({ view, onDelete, sample = false }: { view: RequestView; onDelete?: () => void; sample?: boolean }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const r = view.request;
  const tone = dueTone(r.due_date);
  const step = nextStep(view.progress, view.status === "filled");
  return (
    <motion.li
      initial={{ opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={cn("card flex flex-col gap-3 p-4 sm:p-5", sample && "border-dashed")}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-sunken font-display text-base text-ink-soft" aria-hidden>{initials(r.customer_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{r.customer_name}</span>
            {sample && <span className="pill pill-muted">{t("sample")}</span>}
            <span className={cn("pill", view.status === "filled" ? "pill-primary" : view.status === "new" ? "pill-muted" : "pill-secondary")}>{t(`status.${view.status}`)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span>{view.period?.label ?? "—"}</span>
            {r.template_filename && <span className="flex items-center gap-1 truncate"><FileSpreadsheet className="size-3" aria-hidden />{r.template_filename}</span>}
            {r.due_date && (
              <span className={cn("flex items-center gap-1", tone === "overdue" && "text-danger", tone === "soon" && "text-attention")}>
                <CalendarDays className="size-3" aria-hidden />
                {tone === "overdue" ? t("overdue", { date: new Date(r.due_date + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }) }) : t("due", { date: new Date(r.due_date + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }) })}
              </span>
            )}
            {view.shared_with.length > 0 && <span className="flex items-center gap-1" title={view.shared_with.join(", ")}><Users className="size-3" aria-hidden />{t("sharesYear", { n: view.shared_with.length })}</span>}
          </div>
        </div>
        {onDelete && (
          <button className="btn btn-ghost btn-icon shrink-0 text-muted hover:text-danger" onClick={onDelete} aria-label={t("deleteRequest", { name: r.customer_name })}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <ProgressBar view={view} />
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{t(`seg.${step}`)} · {t("nextUp")}</span>
        {sample ? (
          <span className="btn btn-secondary btn-sm pointer-events-none opacity-70">{t("continue")}</span>
        ) : (
          <Link href={`/r/${r.id}/${step}`} className="btn btn-sm">{view.status === "new" ? t("start") : t("continue")}<ArrowRight className="size-4" aria-hidden /></Link>
        )}
      </div>
    </motion.li>
  );
}

function YearCard({ pv }: { pv: PeriodView }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const months = pv.summary.months.map((m) => shortMonth(m, locale));
  const periodic = pv.summary.energy.filter((e) => e.periodic);
  return (
    <li className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-xl">{pv.period.label}</div>
          <div className="text-xs text-muted">{pv.period.start} → {pv.period.end}</div>
        </div>
        <div className="text-xs text-muted">{t("bills", { n: pv.progress.documents })}{pv.used_by.length > 0 && <> · {t("usedBy", { n: pv.used_by.length, names: pv.used_by.join(", ") })}</>}</div>
      </div>
      {periodic.length > 0 && (
        <ul className="mt-3 space-y-2">
          {periodic.map((e) => (
            <li key={e.energy_type} className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center">
              <span className="text-xs text-muted">{energyLabel(e.energy_type)}</span>
              <CoverageStrip states={e.coverage} months={months} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {pv.totals ? (
          <>
            <span><span className="text-muted">{t("scope1")}</span> <b className="tabular">{t1(pv.totals.scope1_kg)}</b> <span className="text-xs text-muted">tCO2e</span></span>
            <span><span className="text-muted">{t("scope2")}</span> <b className="tabular">{t1(pv.totals.scope2_location_kg)}</b> <span className="text-xs text-muted">tCO2e</span></span>
          </>
        ) : (
          <span className="text-xs text-muted">{pv.progress.documents ? t("notComputed") : t("noBills")}</span>
        )}
      </div>
    </li>
  );
}

function NewRequestDialog({ open, onClose, uid, periods, profile, onCreated }: { open: boolean; onClose: () => void; uid: string; periods: ReportingPeriod[]; profile: SupplierProfile; onCreated: (v: RequestView) => void }) {
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

  useEffect(() => { if (open) setPeriodId(periods[0]?.id ?? "__new"); }, [open, periods]);

  async function create() {
    if (!name.trim()) { setError(t("nameRequired")); return; }
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
      onCreated(v);
      toast(t("created", { name: v.request.customer_name }));
      setName(""); setDue(""); setShare(""); setFile(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} onConfirm={create} title={t("title")} description={t("lede")} confirmLabel={busy ? t("creating") : t("create")} cancelLabel={t("cancel")} busy={busy}>
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="nr-name">{t("customer")}</label>
          <input id="nr-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("customerPlaceholder")} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="nr-period">{t("year")}</label>
          <select id="nr-period" className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.start} → {p.end}</option>)}
            <option value="__new">{t("newYear")}</option>
          </select>
          {periodId !== "__new" && periods.length > 0 && <p className="mt-1 text-xs text-muted">{t("yearHint")}</p>}
        </div>
        {periodId === "__new" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="nr-start">{t("start")}</label><input id="nr-start" className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label className="label" htmlFor="nr-end">{t("end")}</label><input id="nr-end" className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="nr-due">{t("due")}</label><input id="nr-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div><label className="label" htmlFor="nr-share">{t("share")}</label><input id="nr-share" className="input tabular" inputMode="decimal" placeholder="20" value={share} onChange={(e) => setShare(e.target.value)} /></div>
        </div>
        <div>
          <label className="label">{t("template")}</label>
          <input ref={pick} type="file" accept=".xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => pick.current?.click()}><FileSpreadsheet className="size-4" aria-hidden />{file ? t("changeTemplate") : t("chooseTemplate")}</button>
            <span className="truncate text-xs text-muted">{file ? file.name : t("templateOptional")}</span>
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

const TRUST: { icon: LucideIcon; key: string }[] = [
  { icon: BookOpenCheck, key: "factors" },
  { icon: Link2, key: "lineage" },
  { icon: ShieldCheck, key: "honest" },
];

function Home({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("home");
  const tl = useTranslations("landing.trust");
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<HomeView | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RequestView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.home(uid).then(setData).catch((e) => setError((e as Error).message)), [uid]);
  useEffect(() => { load(); }, [load]);

  const sample = useMemo<RequestView>(() => ({
    request: { id: "sample", customer_name: t("sampleCustomer"), period_id: "", template_filename: "cdp_sme_questionnaire.xlsx", due_date: null, created_at: "", updated_at: "" },
    period: { id: "", label: "FY2025", start: "2025-01-01", end: "2025-12-31", created_at: "" },
    status: "new", progress: { bills: false, questions: false, inventory: false, documents: 0, reconcile_status: "idle" }, shared_with: [],
  }), [t]);

  async function remove(v: RequestView) {
    setBusy(true);
    try {
      await api.deleteRequest(uid, v.request.id);
      toast(t("deleted", { name: v.request.customer_name }));
      await load();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data || !profile) return <SkeletonList rows={3} />;

  const periods = data.periods.map((p) => p.period);

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow={profile.name || undefined}
        title={t("greeting", { n: data.requests.length })}
        lede={data.requests.length ? t("ledeSome") : t("ledeNone")}
        aside={<button className="btn" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />{t("newRequest")}</button>}
      />

      {/* Requests ------------------------------------------------------------------- */}
      <section aria-labelledby="req-h" className="space-y-3">
        <h2 id="req-h" className="text-xs font-semibold uppercase tracking-wider text-muted">{t("requests")}</h2>
        {data.requests.length === 0 ? (
          <>
            <ul className="grid gap-3 sm:grid-cols-2">
              <RequestCard view={sample} sample />
              <li>
                <EmptyState icon={Plus} title={t("emptyTitle")} body={t("emptyBody")} action={<button className="btn" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />{t("newRequest")}</button>} />
              </li>
            </ul>
            <ul className="grid gap-3 sm:grid-cols-3">
              {TRUST.map(({ icon: Icon, key }) => (
                <li key={key} className="flex gap-3 rounded-[var(--radius)] bg-sunken/60 p-4">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-raised text-ink-soft"><Icon className="size-4" aria-hidden /></span>
                  <div><div className="text-sm font-medium">{tl(`${key}.title`)}</div><p className="mt-0.5 text-xs text-muted">{tl(`${key}.body`)}</p></div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.requests.map((v) => <RequestCard key={v.request.id} view={v} onDelete={() => setConfirmDelete(v)} />)}
          </ul>
        )}
      </section>

      {/* Reporting years ------------------------------------------------------------- */}
      <section aria-labelledby="years-h" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="years-h" className="text-xs font-semibold uppercase tracking-wider text-muted">{t("years")}</h2>
          <span className="text-xs text-muted">{t("yearsLede")}</span>
        </div>
        {data.periods.length === 0 ? (
          <p className="card p-5 text-sm text-muted">{t("noYears")}</p>
        ) : (
          <ul className="grid gap-3">
            {data.periods.map((pv) => <YearCard key={pv.period.id} pv={pv} />)}
          </ul>
        )}
      </section>

      <NewRequestDialog open={creating} onClose={() => setCreating(false)} uid={uid} periods={periods} profile={profile} onCreated={(v) => { load(); router.push(`/r/${v.request.id}/documents`); }} />

      <Dialog
        open={confirmDelete !== null}
        title={t("deleteTitle")}
        description={confirmDelete ? t("deleteBody", { name: confirmDelete.request.customer_name, year: confirmDelete.period?.label ?? "" }) : ""}
        confirmLabel={t("deleteConfirm")}
        cancelLabel={t("cancel")}
        tone="danger"
        busy={busy}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <Shell>
      <RequireAuth>{(profile, uid) => <Home profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
