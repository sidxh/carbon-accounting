"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BookOpenCheck, CalendarDays, Link2, Plus, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { RequireAuth } from "@/components/require-auth";
import { Shell, nextStep } from "@/components/shell";
import { CoverageStrip, SkeletonList } from "@/components/ui/bits";
import { BlobBackdrop } from "@/components/blob-backdrop";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type HomeView, type PeriodView, type RequestView, type SupplierProfile } from "@/lib/api";
import { RequestFlow } from "./request-flow";
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

/** What matters most about a request right now; one pill per card, in this order of urgency. */
type Urgency = "overdue" | "dueSoon" | "inProgress" | "notStarted" | "done";
const URGENCY_ORDER: Urgency[] = ["overdue", "dueSoon", "inProgress", "notStarted", "done"];
const URGENCY_PILL: Record<Urgency, string> = {
  overdue: "pill-danger", // red
  dueSoon: "pill-attention", // yellow
  inProgress: "pill-secondary", // blue
  notStarted: "pill-muted", // grey
  done: "pill-primary", // green
};

function urgency(v: RequestView): Urgency {
  if (v.status === "filled") return "done";
  const tone = dueTone(v.request.due_date);
  if (tone === "overdue") return "overdue";
  if (tone === "soon") return "dueSoon";
  return v.status === "new" ? "notStarted" : "inProgress";
}

/** Most urgent first; within a group, the nearest due date first (no date last). */
function byUrgency(a: RequestView, b: RequestView): number {
  const g = URGENCY_ORDER.indexOf(urgency(a)) - URGENCY_ORDER.indexOf(urgency(b));
  if (g) return g;
  return (a.request.due_date ?? "9999") < (b.request.due_date ?? "9999") ? -1 : (a.request.due_date ?? "9999") > (b.request.due_date ?? "9999") ? 1 : 0;
}

/** Four bars → Questions → Inventory → Filled, with their names under them (as in setup). */
function ProgressBar({ view }: { view: RequestView }) {
  const t = useTranslations("home");
  const done = { bills: view.progress.bills, questions: view.progress.questions, inventory: view.progress.inventory, filled: view.status === "filled" };
  return (
    <ol className="grid grid-cols-4 gap-2" role="img" aria-label={SEGMENTS.map((k) => `${t(`seg.${k}`)}: ${done[k] ? t("done") : t("todo")}`).join(", ")}>
      {SEGMENTS.map((k) => (
        <li key={k} className="flex flex-col gap-1.5">
          <span className={cn("block h-1 rounded-full", done[k] ? "bg-signal" : "bg-signal/15")} />
          <span className={cn("text-[11px]", done[k] ? "text-ink-soft" : "text-faint")}>{t(`seg.${k}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One customer: who, one coloured pill for what matters now, the year and due
 * date, four bars of progress, and one button to carry on. Nothing else, so it
 * reads at a glance.
 */
function RequestCard({ view, onDelete }: { view: RequestView; onDelete?: () => void }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const r = view.request;
  const u = urgency(view);
  const step = nextStep(view.progress, view.status === "filled");
  const date = r.due_date ? new Date(r.due_date + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }) : null;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="rounded-[24px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_50%,var(--signal-bg)_100%)] p-5 shadow-[var(--shadow-raised)]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-signal-bg font-display text-lg text-signal-ink" aria-hidden>{initials(r.customer_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-display min-w-0 truncate text-xl font-semibold leading-tight text-ink">{r.customer_name}</span>
            <span className={cn("pill", URGENCY_PILL[u])}>{t(`urgency.${u}`)}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <span>{view.period?.label ?? "—"}</span>
            {date && (
              <span className={cn("inline-flex items-center gap-1", u === "overdue" && "text-danger", u === "dueSoon" && "text-attention")}>
                <CalendarDays className="size-3" aria-hidden />{u === "overdue" ? t("overdue", { date }) : t("due", { date })}
              </span>
            )}
          </p>
        </div>
        {onDelete && (
          <button className="btn btn-ghost btn-icon -mr-2 -mt-1 shrink-0 rounded-full text-muted hover:text-danger" onClick={onDelete} aria-label={t("deleteRequest", { name: r.customer_name })}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><ProgressBar view={view} /></div>
        <Link href={`/r/${r.id}/${step}`} className="btn btn-sm shrink-0 gap-1.5 self-end rounded-full sm:self-auto">
          {view.status === "new" ? t("start") : view.status === "filled" ? t("open") : t("continue")}<ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </motion.li>
  );
}

/** One reporting year, compact for the side column: the year in bold, its dates, bills and who uses it, then coverage and totals once there are bills. */
function YearCard({ pv }: { pv: PeriodView }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const months = pv.summary.months.map((m) => shortMonth(m, locale));
  const periodic = pv.summary.energy.filter((e) => e.periodic);
  return (
    <li className="rounded-[24px] border border-signal/15 bg-raised p-5 shadow-[var(--shadow-raised)]">
      <p className="font-display text-2xl font-semibold leading-tight text-ink">{pv.period.label}</p>
      <p className="mt-1 text-sm font-medium tabular text-ink">{pv.period.start} → {pv.period.end}</p>
      <p className="mt-2 text-xs text-muted">
        {t("bills", { n: pv.progress.documents })}
        {pv.used_by.length > 0 && <> · {t("usedByNames", { names: pv.used_by.join(", ") })}</>}
      </p>
      {pv.progress.documents > 0 && periodic.length > 0 && (
        <ul className="mt-3 space-y-2">
          {periodic.map((e) => (
            <li key={e.energy_type} className="grid gap-1">
              <span className="text-xs text-muted">{energyLabel(e.energy_type)}</span>
              <CoverageStrip states={e.coverage} months={months} />
            </li>
          ))}
        </ul>
      )}
      {/* Totals once calculated; a quiet note only when bills are in but not yet calculated. */}
      {(pv.totals || pv.progress.documents > 0) && (
        <div className="mt-4 border-t border-dashed border-signal/25 pt-4">
          {pv.totals ? (
            <div className="grid grid-cols-2 gap-4">
              {([["scope1", pv.totals.scope1_kg], ["scope2", pv.totals.scope2_location_kg]] as const).map(([k, kg]) => (
                <span key={k} className="flex flex-col">
                  <span className="text-xs text-muted">{t(k)}</span>
                  <span><span className="font-display tabular text-3xl leading-none text-ink">{t1(kg)}</span> <span className="text-xs text-muted">tCO2e</span></span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted">{t("notComputed")}</span>
          )}
        </div>
      )}
    </li>
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
  const [data, setData] = useState<HomeView | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RequestView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.home(uid).then(setData).catch((e) => setError((e as Error).message)), [uid]);
  useEffect(() => { load(); }, [load]);


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

  const none = data.requests.length === 0;
  const label = "font-mono text-xs text-signal-ink";
  const flow = (onCancel?: () => void) => (
    <RequestFlow uid={uid} periods={periods} profile={profile} onCancel={onCancel} onCreated={() => { setCreating(false); load(); }} />
  );

  const years = (
    <section aria-labelledby="years-h" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="years-h" className={label}>↳ {t("years")}</h2>
        <span className="text-xs text-muted">{t("yearsLede")}</span>
      </div>
      {data.periods.length === 0 ? (
        <p className="rounded-[24px] border border-dashed border-signal/30 bg-raised/80 p-5 text-sm text-muted">{t("noYears")}</p>
      ) : (
        <ul className="grid gap-4">
          {data.periods.map((pv) => <YearCard key={pv.period.id} pv={pv} />)}
        </ul>
      )}
    </section>
  );

  return (
    <div className="relative z-10 space-y-10 pb-12">
      <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", none && "mx-auto max-w-3xl")}>
        <div className="max-w-2xl">
          {profile.name && (
            <p className="inline-flex items-center gap-2 rounded-full border border-signal/20 bg-signal-bg px-4 py-1.5 text-sm font-medium text-signal-ink">
              <span className="size-2 rounded-full bg-attention-strong" aria-hidden />{profile.name}
            </p>
          )}
          <h1 className="font-display mt-4 text-[clamp(2.4rem,5vw,3.5rem)] leading-[1.02] text-balance text-ink">{none ? t("firstTitle") : t("greeting", { n: data.requests.length })}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-pretty text-ink-soft">{none ? t("ledeNone") : t("ledeSome")}</p>
        </div>
        {!none && !creating && (
          <button className="btn gap-1.5 rounded-full" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />{t("newRequest")}</button>
        )}
      </header>

      {none ? (
        /* No requests yet: the first one is asked for right here, then the years. */
        <div className="mx-auto max-w-3xl space-y-10">
          <section aria-label={t("emptyTitle")} className="space-y-4">
            {flow()}
            <ul className="grid gap-3 sm:grid-cols-3">
              {TRUST.map(({ icon: Icon, key }) => (
                <li key={key} className="flex gap-3 rounded-[20px] border border-signal/15 bg-raised p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-signal-bg text-signal-ink"><Icon className="size-4" aria-hidden /></span>
                  <div><div className="text-sm font-medium text-ink">{tl(`${key}.title`)}</div><p className="mt-0.5 text-xs text-muted">{tl(`${key}.body`)}</p></div>
                </li>
              ))}
            </ul>
          </section>
          {years}
        </div>
      ) : (
        /* Customers on the left, most urgent first; their reporting years beside them, held in view. */
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {creating && (
                <motion.div
                  initial={{ opacity: 0, transform: "translateY(-8px)" }}
                  animate={{ opacity: 1, transform: "translateY(0px)" }}
                  exit={{ opacity: 0, transform: "translateY(-8px)" }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                >
                  {flow(() => setCreating(false))}
                </motion.div>
              )}
            </AnimatePresence>
            <section aria-labelledby="req-h" className="space-y-4">
              <h2 id="req-h" className={label}>↳ {t("customers")}</h2>
              <ul className="grid gap-4">
                {[...data.requests].sort(byUrgency).map((v) => <RequestCard key={v.request.id} view={v} onDelete={() => setConfirmDelete(v)} />)}
              </ul>
            </section>
          </div>
          <div className="lg:sticky lg:top-6">{years}</div>
        </div>
      )}

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
    <Shell wide>
      <BlobBackdrop />
      <RequireAuth>{(profile, uid) => <Home profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
