"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowRight, ArrowUpDown, ArrowUpRight, Calculator, Check, ChevronDown, ExternalLink, FileText, Info, Pencil, RefreshCw, ScanSearch, Sun, X } from "lucide-react";
import { Dialog as BaseDialog } from "@base-ui/react";
import { cn as clsx } from "@/lib/cn";
import { useRequest } from "@/components/request-context";
import { ReducePlanner } from "@/components/reduce-planner";
import { SharedNotice } from "@/components/shared-notice";
import { EmptyState, PageTitle, SkeletonList, TIER_PILL } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { CheckPills, EvidenceViewer } from "@/components/evidence-viewer";
import { evidenceFor } from "@/lib/evidence";
import { useToast } from "@/components/ui/toast";
import { api, type ActivityLine, type Assumption, type DocumentRecord, type InventoryLine, type Snapshot } from "@/lib/api";
import { ENERGY_ORDER, energyLabel, shortMonth } from "@/lib/coverage";

const t1 = (kg: number, d = 2) => (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: d });
const num = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });

const shortDate = (iso: string, locale?: string) => new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "2-digit", month: "short" });
/** A line's period with its year as '26, once at the end when both dates share it: "Feb 01 – Feb 28 '26". */
function periodLabel(start: string, end: string, locale?: string) {
  const yy = (iso: string) => `’${iso.slice(2, 4)}`;
  if (start === end) return `${shortDate(start, locale)} ${yy(start)}`;
  if (start.slice(0, 4) === end.slice(0, 4)) return `${shortDate(start, locale)} – ${shortDate(end, locale)} ${yy(end)}`;
  return `${shortDate(start, locale)} ${yy(start)} – ${shortDate(end, locale)} ${yy(end)}`;
}

// --- lineage pieces -------------------------------------------------------------

function SourceThumb({ uid, pid, docId, doc }: { uid: string; pid: string; docId: string; doc?: DocumentRecord }) {
  const t = useTranslations("inventory");
  const [src, setSrc] = useState<string | null>(null);
  const isImage = !!doc && doc.mime_type.startsWith("image/");
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    api.documentFileUrl(uid, pid, docId).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [uid, pid, docId, isImage]);

  if (docId.startsWith("assumption:")) {
    return <div className="grid h-24 w-20 shrink-0 place-items-center rounded-lg bg-attention-bg px-1 text-center text-[11px] leading-tight text-attention">{t("fromAssumption")}</div>;
  }
  if (!isImage) {
    return <div className="grid h-24 w-20 shrink-0 place-items-center rounded-lg bg-sunken text-muted"><FileText className="size-5" aria-hidden /><span className="sr-only">PDF</span></div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="h-24 w-20 shrink-0 rounded-lg border hairline object-cover" /> : <div className="skeleton h-24 w-20 shrink-0" />;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-raised" aria-hidden>{n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</div>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </li>
  );
}

/** One assumption: the owner's answer, how it filled the number, and the question behind it. */
function AssumptionCard({ a }: { a: Assumption }) {
  const t = useTranslations("inventory");
  const [full, setFull] = useState(false);
  const long = a.question.length > 140;
  return (
    <div className="rounded-2xl border hairline bg-raised p-3 sm:p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{t("assumption.answer")}</div>
      <p className="mt-1 font-display text-xl leading-snug text-pretty text-ink">&ldquo;{a.answer}&rdquo;</p>
      {a.method && (
        <div className="mt-3 rounded-xl bg-attention-bg p-2.5 pl-3 text-xs text-attention">
          <span className="font-medium">{t("assumption.used")}</span> {a.method}
        </div>
      )}
      <div className="mt-3 border-t hairline pt-3">
        <div className="text-[11px] uppercase tracking-wider text-muted">{t("assumption.asked")}</div>
        <p className={clsx("mt-1 text-xs leading-relaxed text-pretty text-ink-soft", long && !full && "line-clamp-3")}>{a.question}</p>
        {long && (
          <button type="button" className="mt-1 text-xs font-medium text-signal-ink underline-offset-2 hover:underline" aria-expanded={full} onClick={() => setFull((v) => !v)}>
            {full ? t("assumption.less") : t("assumption.more")}
          </button>
        )}
      </div>
    </div>
  );
}

function Calculation({ uid, pid, line, market, activity, doc, assumptions, onChanged }: { uid: string; pid: string; line: InventoryLine; market?: InventoryLine; activity?: ActivityLine; doc?: DocumentRecord; assumptions: Assumption[]; onChanged: () => void }) {
  const t = useTranslations("inventory");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.quantity));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showing, setShowing] = useState(false);
  const locale = useLocale();
  const evidence = evidenceFor(line, activity, doc, locale);
  const asms = assumptions.filter((a) => line.assumption_ids.includes(a.id));
  const notes = (line.activity_notes || activity?.notes || "").split(" | ").map((s) => s.trim()).filter(Boolean);
  const where = line.factor_region || line.factor_country;

  async function save() {
    setBusy(true);
    try {
      await api.patchLine(uid, pid, line.activity_line_id, { quantity: Number(qty) });
      setEditing(false);
      onChanged();
      toast(t("recomputed"));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const changed = Number(qty) !== line.quantity && !Number.isNaN(Number(qty));

  // Whether the assumptions and the calculation together would run past the steps
  // beside them (two columns only); if so the calculation goes on top.
  const stepsRef = useRef<HTMLOListElement>(null);
  const asmRef = useRef<HTMLElement>(null);
  const calcRef = useRef<HTMLElement>(null);
  const [assumptionsTall, setAssumptionsTall] = useState(false);
  useEffect(() => {
    const steps = stepsRef.current, asm = asmRef.current, calc = calcRef.current;
    if (!steps || !asm || !calc) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const measure = () => setAssumptionsTall(wide.matches && asm.offsetHeight + 16 + calc.offsetHeight > steps.offsetHeight);
    const ro = new ResizeObserver(measure);
    [steps, asm, calc].forEach((el) => ro.observe(el));
    wide.addEventListener("change", measure);
    measure();
    return () => { ro.disconnect(); wide.removeEventListener("change", measure); };
  }, []);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <ol ref={stepsRef} className="space-y-4">
        {/* One step for the bill and what we read from it, built round "Show me where":
            the quickest way to trust a number is to see it on the bill itself. */}
        <Step n={1} title={t("step.bill")}>
          <div className="rounded-2xl border hairline bg-raised p-3 sm:p-4">
            <div className="flex items-start gap-4">
              {evidence ? (
                <button type="button" onClick={() => setShowing(true)} className="group relative shrink-0 rounded-lg" aria-label={t("showMe")}>
                  <SourceThumb uid={uid} pid={pid} docId={line.source_doc_id} doc={doc} />
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 rounded-b-lg bg-ink/70 py-0.5 text-[10px] font-medium text-raised transition-colors group-hover:bg-signal-ink"><ScanSearch className="size-3" aria-hidden />{t("showMeShort")}</span>
                </button>
              ) : (
                <SourceThumb uid={uid} pid={pid} docId={line.source_doc_id} doc={doc} />
              )}
              <div className="min-w-0 flex-1">
                {doc?.filename && <div className="truncate font-medium">{doc.filename}</div>}
                {notes.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5 text-xs text-muted">
                    {notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-display text-3xl leading-none tabular">{num(line.quantity, 2)}</span>
                  <span className="text-muted">{line.unit}</span>
                  <span className={clsx("pill", TIER_PILL[line.tier])} title={t(`tierWhy.${line.tier}`)}>{t(`tier.${line.tier}`)}</span>
                </div>
                {activity?.checks && activity.checks.length > 0 && <CheckPills checks={activity.checks} className="mt-2" />}
              </div>
            </div>

            {evidence && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-signal-bg p-2 pl-3">
                <span className="min-w-0 flex-1 text-sm text-signal-ink">{t("showMeHint", { qty: `${num(line.quantity, 2)} ${line.unit}` })}</span>
                <button type="button" className="btn gap-1.5 rounded-full" onClick={() => setShowing(true)}>
                  <ScanSearch className="size-4" aria-hidden />{t("showMe")}
                </button>
              </div>
            )}

            {line.basis !== "market" && (
              <div className="mt-2">
                {editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`qty-${line.id}`}>{t("correct")}</label>
                    <input id={`qty-${line.id}`} className="input max-w-[160px] tabular" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
                    <span className="text-sm">{line.unit}</span>
                    <button className="btn btn-sm" onClick={() => setConfirm(true)} disabled={busy || !changed}>{t("save")}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setQty(String(line.quantity)); }}>{t("cancel")}</button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-sm gap-1.5 text-muted" onClick={() => setEditing(true)}><Pencil className="size-3.5" aria-hidden />{t("correct")}</button>
                )}
              </div>
            )}
            <div className="mt-1 font-mono text-[11px] text-muted/80">{line.source_doc_id}</div>
          </div>
        </Step>

        {/* The rate the quantity is multiplied by: the number first, then whose it is,
            then the facts an auditor checks, then any caveat. Same box as step 1. */}
        <Step n={2} title={t("step.factor")}>
          <div className="rounded-2xl border hairline bg-raised p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-display text-3xl leading-none tabular">{line.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                <span className="text-muted">kgCO2e / {line.unit}</span>
                {line.factor_gas && <span className="pill pill-muted">{line.factor_gas}</span>}
              </div>
              {line.factor_source_url && (
                <a href={line.factor_source_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm gap-1.5 rounded-full">
                  {t("factorCard.openSource")}<ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
            <p className="mt-2 text-sm font-medium text-pretty text-ink">{line.factor_source_name}</p>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t hairline pt-3 sm:grid-cols-4">
              {[
                [t("factorCard.vintage"), line.factor_vintage],
                [t("factorCard.appliesTo"), line.factor_year ?? "—"],
                [t("factorCard.region"), where],
                [t("factorCard.methodLabel"), t(`method.${line.method}`)],
              ].map(([k, v]) => (
                <div key={String(k)} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wider text-muted">{k}</dt>
                  <dd className="mt-0.5 text-sm text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            {(!line.exact_year || !line.exact_region || line.fell_back_to) && (
              <ul className="mt-3 space-y-1 rounded-xl bg-attention-bg p-2.5 pl-3 text-xs text-attention">
                {!line.exact_year && <li className="flex gap-2"><Info className="mt-px size-3.5 shrink-0" aria-hidden />{t("factorCard.nearestYear", { year: line.factor_year ?? "" })}</li>}
                {!line.exact_region && <li className="flex gap-2"><Info className="mt-px size-3.5 shrink-0" aria-hidden />{t("factorCard.nationalFallback")}</li>}
                {line.fell_back_to && <li className="flex gap-2"><Info className="mt-px size-3.5 shrink-0" aria-hidden />{t("factorCard.marketFallback")}</li>}
              </ul>
            )}
            <div className="mt-2 font-mono text-[11px] text-muted/80">{line.factor_id}</div>
          </div>
        </Step>

      </ol>

      {/* The right column: the assumptions behind this line, then the calculation,
          both in the same box as the steps. When the assumptions would run longer than
          the steps beside them, the calculation moves above them so the result stays in
          view; on phones it always follows the steps. Order is CSS only, so nothing remounts. */}
      <div className="flex min-w-0 flex-col gap-4">
        <aside ref={asmRef} className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("assumptions")}{asms.length > 1 ? ` · ${asms.length}` : ""}</div>
          <div className="mt-1 space-y-3">
            {asms.length > 0 ? (
              asms.map((a) => <AssumptionCard key={a.id} a={a} />)
            ) : (
              <div className="flex items-start gap-2 rounded-2xl border hairline bg-raised p-3 text-sm text-ink-soft sm:p-4">
                <Check className="mt-0.5 size-4 shrink-0 text-signal-ink" aria-hidden />{t("noAssumptions")}
              </div>
            )}
            <div className="px-1 font-mono text-[11px] text-muted/80">{line.period_start} → {line.period_end}{line.site_id ? ` · ${line.site_id}` : ""}</div>
          </div>
        </aside>

        <section ref={calcRef} aria-label={t("step.result")} className={clsx("min-w-0 max-lg:order-first", assumptionsTall ? "lg:order-first" : "lg:order-last")}>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("step.result")}</div>
          <div className="mt-1">
            <div className="rounded-2xl border hairline bg-raised p-3 sm:p-4">
              {/* Stacked, so it reads in a narrow column: quantity, × factor, = kg, = tonnes. */}
              <div className="space-y-0.5 font-mono text-sm tabular">
                <div>{num(line.quantity, 2)} <span className="text-muted">{line.unit}</span></div>
                <div><span className="text-muted">×</span> {line.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-muted">kgCO2e/{line.unit}</span></div>
                <div><span className="text-muted">=</span> {num(line.kg_co2e, 1)} <span className="text-muted">kgCO2e</span></div>
              </div>
              <div className="mt-2 border-t hairline pt-2 font-display text-2xl leading-none tabular text-signal-ink">
                = {t1(line.kg_co2e, 3)} <span className="font-sans text-sm text-muted">tCO2e</span>
              </div>
              {market && (
                <div className="mt-3 border-t hairline pt-2 text-xs text-muted">
                  <div>{t("scope2mkt")}</div>
                  <div className="mt-0.5 font-mono tabular">{num(market.quantity, 2)} {market.unit} × {market.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })} = {t1(market.kg_co2e, 3)} tCO2e</div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {evidence && <EvidenceViewer uid={uid} pid={pid} items={[evidence]} index={0} onIndex={() => {}} open={showing} onClose={() => setShowing(false)} />}

      <Dialog
        open={confirm}
        title={t("correctTitle")}
        description={t("correctBody", { from: num(line.quantity, 2), to: qty, unit: line.unit })}
        confirmLabel={t("save")}
        cancelLabel={t("cancel")}
        busy={busy}
        onConfirm={save}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}

// --- table -----------------------------------------------------------------------

function Row({ uid, pid, line, market, activity, doc, assumptions, onChanged, open, onToggle }: { uid: string; pid: string; line: InventoryLine; market?: InventoryLine; activity?: ActivityLine; doc?: DocumentRecord; assumptions: Assumption[]; onChanged: () => void; open: boolean; onToggle: () => void }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const id = `calc-${line.id.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <>
      {/* The whole row opens it; the chevron button is the keyboard and screen-reader way in. */}
      <tr className={clsx("cursor-pointer border-t hairline transition-colors", open ? "bg-sunken/60" : "hover:bg-sunken/40")} onClick={onToggle}>
        <td className="px-3 py-2">
          <button className="flex min-h-9 items-center gap-2 text-left text-xs text-muted" aria-expanded={open} aria-controls={id} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <ChevronDown className={clsx("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
            <span className="whitespace-nowrap">{periodLabel(line.period_start, line.period_end, locale)}</span>
          </button>
        </td>
        <td className="px-3 py-2 text-sm">{energyLabel(line.energy_type)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular">{num(line.quantity)} <span className="text-xs text-muted">{line.unit}</span></td>
        <td className="hidden px-3 py-2 text-right text-xs tabular text-muted sm:table-cell">{line.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td className="px-3 py-2 text-right text-sm font-medium tabular">{t1(line.kg_co2e)}</td>
        <td className="px-3 py-2 text-right"><span className={clsx("pill", TIER_PILL[line.tier])}>{t(`tier.${line.tier}`)}</span></td>
      </tr>
      <AnimatePresence initial={false}>
        {open && (
          <tr id={id} className="bg-sunken/60">
            <td colSpan={6} className="px-4 pb-5 pt-1">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}>
                <Calculation uid={uid} pid={pid} line={line} market={market} activity={activity} doc={doc} assumptions={assumptions} onChanged={onChanged} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// --- dashboard ---------------------------------------------------------------------

/** Rounds a chart's top up to 1, 2 or 5 times a power of ten, so its gridlines read cleanly. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

const sharePct = (kg: number, total: number) => {
  const p = total ? (kg / total) * 100 : 0;
  return `${p < 1 && p > 0 ? "<1" : Math.round(p)}%`;
};

/**
 * Estimated means hatched, everywhere on the dashboard: yellow diagonal stripes laid
 * over whatever colour the figure already has (a scope's colour in the bars, the
 * neutral in the data-quality bar), so green only ever means Scope 2.
 */
const HATCH: React.CSSProperties = { backgroundImage: "repeating-linear-gradient(135deg, var(--attention-strong) 0 2px, transparent 2px 5px)" };

type Slice = "s1" | "s2";

/**
 * The year's Scope 1 + 2 as a small ring, with its own key underneath. Hovering (or
 * focusing) a slice or a key row brings that slice forward and puts its exact figure
 * in the middle; otherwise the middle shows the total. Market-based Scope 2 is a
 * footnote (it counts the same electricity a second way, it does not add), and the
 * data quality closes the card.
 */
function ScopeDonut({ scope1, scope2, market, estimatedShare }: { scope1: number; scope2: number; market: number; estimatedShare: number }) {
  const t = useTranslations("inventory");
  const [active, setActive] = useState<Slice | null>(null);
  const total = scope1 + scope2;
  const p1 = total ? (scope1 / total) * 100 : 0;
  const p2 = total ? 100 - p1 : 0;
  const gap = p1 > 0 && p2 > 0 ? 0.8 : 0;
  const rows = [
    { key: "s1" as const, label: t("scope1short"), note: t("scope1Note"), kg: scope1, len: p1, offset: 0, color: "var(--ink)", dot: "bg-ink" },
    { key: "s2" as const, label: t("scope2short"), note: t("scope2Note"), kg: scope2, len: p2, offset: p1, color: "var(--signal)", dot: "bg-signal" },
  ];
  const shown = rows.find((r) => r.key === active);
  const on = (k: Slice) => ({ onPointerEnter: () => setActive(k), onPointerLeave: () => setActive(null), onFocus: () => setActive(k), onBlur: () => setActive(null) });
  const est = Math.round(estimatedShare * 100);

  return (
    <section className="card flex flex-col p-5 sm:p-6" aria-labelledby="donut-h">
      <h2 id="donut-h" className="font-display text-xl">{t("total")}</h2>
      <div className="flex flex-1 items-center justify-center py-4">
        <div className="relative size-40 shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={rows.map((r) => `${r.label} ${t1(r.kg)} tCO2e (${sharePct(r.kg, total)})`).join(", ")}>
            <circle cx={50} cy={50} r={40} fill="none" stroke="var(--sunken)" strokeWidth={14} />
            {rows.map((r) => r.len - gap > 0 && (
              <circle
                key={r.key}
                {...on(r.key)}
                cx={50} cy={50} r={40} fill="none" stroke={r.color} pathLength={100}
                strokeWidth={active === r.key ? 18 : 14}
                strokeDasharray={`${r.len - gap} ${100 - r.len + gap}`}
                strokeDashoffset={-r.offset - gap / 2}
                opacity={active && active !== r.key ? 0.3 : 1}
                className="cursor-default transition-[stroke-width,opacity] duration-150"
              />
            ))}
          </svg>
          {/* The middle: the total, or the hovered slice's exact figure. */}
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center" aria-live="polite">
            {shown ? (
              <motion.div key={shown.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                <div className="font-display text-[1.6rem] leading-none tabular text-ink">{t1(shown.kg)}<span className="ml-0.5 font-sans text-[11px] text-muted">t</span></div>
                <div className="mt-1 whitespace-nowrap text-[11px] text-muted">{shown.label} · {sharePct(shown.kg, total)}</div>
              </motion.div>
            ) : (
              <div>
                <div data-total data-value={(total / 1000).toFixed(2)} className="font-display text-[1.75rem] leading-none tabular text-signal-ink">
                  <NumberFlow value={total / 1000} format={{ maximumFractionDigits: total >= 100000 ? 1 : 2 }} transformTiming={{ duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }} spinTiming={{ duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }} />
                </div>
                <div className="mt-0.5 text-[11px] text-muted">{t("tonnes")}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The ring's key: dot, what it covers, tonnes, share, in aligned columns. */}
      <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 text-sm">
        {rows.map((r) => (
          <li key={r.key} tabIndex={0} {...on(r.key)} className={clsx("col-span-4 grid grid-cols-subgrid items-start rounded-lg px-2 py-1.5 outline-none transition-colors", active === r.key ? "bg-sunken" : "hover:bg-sunken")}>
            <span className={clsx("mt-1.5 size-2.5 rounded-full", r.dot)} aria-hidden />
            <span className="min-w-0"><span className="block font-medium text-ink">{r.label}</span><span className="block truncate text-xs text-muted">{r.note}</span></span>
            <span data-stat data-value={(r.kg / 1000).toFixed(2)} className="text-right tabular text-ink">{t1(r.kg)} <span className="text-xs text-muted">t</span></span>
            <span className="w-9 pt-0.5 text-right text-xs tabular text-muted">{sharePct(r.kg, total)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 px-2 text-xs text-muted">
        {t.rich("marketFootnote", { t: () => <span data-stat data-value={(market / 1000).toFixed(2)} className="tabular">{t1(market)}</span> })}
      </p>

      {/* Data quality: read from bills (solid) against estimated (hatched). No green here. */}
      <div className="mt-4 border-t hairline px-2 pt-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${t("quality.read", { pct: `${100 - est}%` })}, ${t("quality.estimated", { pct: `${est}%` })}`}>
          <span className="block bg-ink/70" style={{ width: `${100 - est}%` }} />
          <span className="block bg-attention-bg" style={{ width: `${est}%`, ...HATCH }} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink/70" aria-hidden />{t("quality.read", { pct: `${100 - est}%` })}</span>
          {est > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-attention-bg" style={HATCH} aria-hidden />{t("quality.estimated", { pct: `${est}%` })}</span>}
        </div>
      </div>
    </section>
  );
}

/**
 * The months as stacked bars in the ring's colours (Scope 1 ink, Scope 2 signal); the
 * estimated part of a month is hatched over them. Hovering or focusing a month shows
 * its exact figures; the year is marked under the first month and each January.
 */
function MonthlyChart({ byMonth }: { byMonth: Record<string, { scope1: number; scope2_location: number; estimated: number }> }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const months = Object.keys(byMonth).sort();
  const top = niceMax(Math.max(...months.map((m) => byMonth[m].scope1 + byMonth[m].scope2_location), 1) / 1000) * 1000;
  const anyEstimated = months.some((m) => byMonth[m].estimated > 0);
  const yy = (m: string) => `’${m.slice(2, 4)}`;
  return (
    <figure className="card flex flex-col p-5 sm:p-6">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-xl">{t("chart.title")}</span>
        <span className="flex flex-wrap gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ink" aria-hidden />{t("scope1short")}</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-signal" aria-hidden />{t("scope2short")}</span>
          {anyEstimated && <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-attention-bg" style={HATCH} aria-hidden />{t("tier.estimated")}</span>}
        </span>
      </figcaption>
      {months.length > 0 && (
        <div className="mt-5 flex h-48 flex-1 gap-2">
          {/* The scale: top, half and zero, in tonnes. */}
          <div className="flex flex-col justify-between pb-8 text-right text-[10px] leading-none tabular text-muted" aria-hidden>
            <span>{t1(top, 1)}</span><span>{t1(top / 2, 1)}</span><span>0</span>
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 bottom-8 flex flex-col justify-between" aria-hidden>
              {[0, 1, 2].map((i) => <span key={i} className={clsx("block border-t", i === 2 ? "border-line-strong" : "border-dashed border-line")} />)}
            </div>
            <ul className="relative flex h-full">
              {months.map((m, i) => {
                const b = byMonth[m];
                const sum = b.scope1 + b.scope2_location;
                const h = (sum / top) * 100;
                const label = `${shortMonth(m, locale)} ${yy(m)}`;
                const showYear = i === 0 || m.endsWith("-01");
                const align = i < 2 ? "left-0" : i > months.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
                return (
                  <li
                    key={m}
                    tabIndex={0}
                    aria-label={`${label}: ${t("scope1short")} ${t1(b.scope1)}, ${t("scope2short")} ${t1(b.scope2_location)} tCO2e${b.estimated ? `, ${t("estimatedNote")}` : ""}`}
                    onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    className={clsx("relative flex h-full min-w-0 flex-1 flex-col items-center rounded-md outline-none transition-colors", hover === i && "bg-sunken/70")}
                  >
                    <div className="relative flex w-full flex-1 flex-col justify-end">
                      <div className="relative mx-auto flex w-[62%] max-w-7 flex-col overflow-hidden rounded-t-[6px] rounded-b-[2px]" style={{ height: `${h}%` }}>
                        <span className="block bg-ink" style={{ height: sum ? `${(b.scope1 / sum) * 100}%` : 0 }} />
                        <span className="block flex-1 bg-signal" />
                        {b.estimated > 0 && <span className="absolute inset-x-0 bottom-0 block" style={{ height: `${Math.min(1, b.estimated / (sum || 1)) * 100}%`, ...HATCH }} />}
                      </div>
                      {hover === i && (
                        <div className={clsx("pointer-events-none absolute z-10 w-max min-w-36 rounded-xl border hairline bg-raised px-3 py-2 text-xs shadow-[var(--shadow-float)]", align)} style={{ bottom: `calc(${h}% + 8px)` }} aria-hidden>
                          <div className="font-medium text-ink">{label}</div>
                          <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 tabular">
                            <span className="size-2 rounded-full bg-ink" /><span className="text-muted">{t("scope1short")}</span><span className="text-right">{t1(b.scope1)} t</span>
                            <span className="size-2 rounded-full bg-signal" /><span className="text-muted">{t("scope2short")}</span><span className="text-right">{t1(b.scope2_location)} t</span>
                            <span /><span className="font-medium text-ink">{t("total")}</span><span className="text-right font-medium text-ink">{t1(sum)} t</span>
                          </div>
                          {b.estimated > 0 && <div className="mt-1 flex items-center gap-1.5 text-muted"><span className="size-2 rounded-[2px] bg-attention-bg" style={HATCH} />{t("estimatedNote")}</div>}
                        </div>
                      )}
                    </div>
                    <span className="mt-1.5 h-3 text-[10px] leading-none text-muted">{shortMonth(m, locale)}</span>
                    <span className="h-3.5 pt-0.5 text-[9px] leading-none text-muted/80">{showYear ? yy(m) : ""}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </figure>
  );
}

// --- where to cut ---------------------------------------------------------------------

/**
 * "Where you could cut emissions": an invitation that opens the reduction plan in
 * a dialog over the inventory (the page behind blurred), rather than a new page.
 */
function CutCard() {
  const t = useTranslations("inventory.cut");
  const tReduce = useTranslations("reduce");
  const [open, setOpen] = useState(false);
  return (
    <BaseDialog.Root open={open} onOpenChange={setOpen}>
      <BaseDialog.Trigger className="card group flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-sunken sm:p-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-attention-bg text-attention"><Sun className="size-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl text-balance">{tReduce("card.title")}</span>
          <span className="mt-0.5 block text-sm text-pretty text-muted">{tReduce("card.body")}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 text-sm font-medium text-signal-ink sm:inline-flex">
          {t("explore")}
          <span className="grid size-8 place-items-center rounded-full border hairline transition-colors group-hover:bg-raised"><ArrowUpRight className="size-4" aria-hidden /></span>
        </span>
        <ArrowUpRight className="size-5 shrink-0 text-signal-ink sm:hidden" aria-hidden />
      </BaseDialog.Trigger>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-dialog bg-ink/25 backdrop-blur-md transition-opacity duration-[var(--dur-enter)] ease-[var(--ease-out)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <BaseDialog.Popup className="card fixed left-1/2 top-1/2 z-dialog flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden shadow-[var(--shadow-float)] outline-none transition-[scale,opacity] duration-[var(--dur-enter)] ease-[var(--ease-out)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 sm:max-h-[88dvh]">
          <div className="flex items-start gap-4 border-b hairline p-5 sm:p-6">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-attention-bg text-attention"><Sun className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <BaseDialog.Title className="font-display text-2xl leading-tight text-balance text-ink">{tReduce("title")}</BaseDialog.Title>
              <BaseDialog.Description className="mt-1 text-sm text-pretty text-muted">{tReduce("lede")}</BaseDialog.Description>
            </div>
            <BaseDialog.Close className="grid size-9 shrink-0 place-items-center rounded-full border hairline text-muted transition-colors hover:bg-sunken hover:text-ink" aria-label={t("close")}>
              <X className="size-4" aria-hidden />
            </BaseDialog.Close>
          </div>
          <div className="overflow-y-auto overscroll-contain p-5 sm:p-6">
            {open && <ReducePlanner variant="dialog" />}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

// --- page --------------------------------------------------------------------------

type SortKey = "period" | "emissions";

function Inventory() {
  const { uid, profile, period, request, view: rv, reload } = useRequest();
  const pid = period.id;
  const t = useTranslations("inventory");
  const toast = useToast();
  const [data, setData] = useState<{ lines: InventoryLine[]; snapshot: Snapshot | null; assumptions: Assumption[]; activityLines: ActivityLine[] } | null>(null);
  const [docs, setDocs] = useState<Record<string, DocumentRecord>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("period");
  const [methodOpen, setMethodOpen] = useState(false);

  const load = useCallback(() => api.inventory(uid, pid).then(setData), [uid, pid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.listDocuments(uid, pid).then((r) => setDocs(Object.fromEntries(r.documents.map((d) => [d.id, d])))).catch(() => {});
  }, [uid, pid]);

  async function compute() {
    setBusy(true);
    try {
      await api.compute(uid, pid);
      await load();
      await reload();
      toast(t("recomputed"));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  const view = useMemo(() => {
    if (!data) return null;
    const { lines, activityLines } = data;
    const byActivity = Object.fromEntries(activityLines.map((a) => [a.id, a]));
    const marketByActivity = Object.fromEntries(lines.filter((l) => l.basis === "market").map((l) => [l.activity_line_id, l]));
    const headline = lines.filter((l) => l.basis !== "market");
    const types = Array.from(new Set(headline.map((l) => l.energy_type))).sort((a, b) => ENERGY_ORDER.indexOf(a) - ENERGY_ORDER.indexOf(b));
    const shown = headline
      .filter((l) => !filterType || l.energy_type === filterType)
      .filter((l) => !filterTier || l.tier === filterTier)
      .sort((a, b) => (sort === "emissions" ? b.kg_co2e - a.kg_co2e : a.period_start.localeCompare(b.period_start) || a.energy_type.localeCompare(b.energy_type)));
    const groups: { scope: number; type: string; lines: InventoryLine[]; kg: number }[] = [];
    for (const l of shown) {
      let g = groups.find((x) => x.scope === l.scope && x.type === l.energy_type);
      if (!g) { g = { scope: l.scope, type: l.energy_type, lines: [], kg: 0 }; groups.push(g); }
      g.lines.push(l); g.kg += l.kg_co2e;
    }
    groups.sort((a, b) => a.scope - b.scope || ENERGY_ORDER.indexOf(a.type) - ENERGY_ORDER.indexOf(b.type));
    const factors = new Map<string, InventoryLine>();
    for (const l of lines) if (!factors.has(l.factor_id)) factors.set(l.factor_id, l);
    return { byActivity, marketByActivity, headline, types, groups, factors: Array.from(factors.values()) };
  }, [data, filterType, filterTier, sort]);

  if (!data || !view) return <SkeletonList rows={4} />;
  const { snapshot, assumptions } = data;

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <PageTitle title={t("title")} lede={t("lede")} />
        <SharedNotice sharedWith={rv.shared_with} periodLabel={period.label} />
        <EmptyState icon={Calculator} title={t("notComputed")} body={t("notComputedBody")} action={<button className="btn" onClick={compute} disabled={busy}><Calculator className="size-4" aria-hidden />{t("compute")}</button>} />
      </div>
    );
  }

  const tot = snapshot.totals;
  const sites = profile.sites;
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-6 pb-16">
      <PageTitle
        title={t("title")}
        lede={t("lede")}
        aside={<button className="btn btn-secondary btn-sm gap-1.5" onClick={compute} disabled={busy}><RefreshCw className={clsx("size-3.5", busy && "animate-spin")} aria-hidden />{t("recompute")}</button>}
      />
      <SharedNotice sharedWith={rv.shared_with} periodLabel={period.label} />

      {/* Dashboard: the year's split beside its months; below, where it could be cut. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <ScopeDonut scope1={tot.scope1_kg} scope2={tot.scope2_location_kg} market={tot.scope2_market_kg} estimatedShare={tot.tier_mix.estimated ?? 0} />
        <MonthlyChart byMonth={tot.by_month ?? {}} />
      </div>
      <CutCard />

      {/* Method card ------------------------------------------------------------------- */}
      <section className="card" aria-labelledby="method-h">
        <button className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5" aria-expanded={methodOpen} onClick={() => setMethodOpen((v) => !v)}>
          <span>
            <span id="method-h" className="flex items-center gap-2 font-display text-xl"><Info className="size-4 text-muted" aria-hidden />{t("method.title")}</span>
            <span className="mt-1 block text-sm text-muted">{t("method.lede", { n: view.factors.length, a: assumptions.length })}</span>
          </span>
          <ChevronDown className={clsx("size-5 shrink-0 text-muted transition-transform", methodOpen && "rotate-180")} aria-hidden />
        </button>
        {methodOpen && (
          <div className="grid gap-5 border-t hairline p-4 text-sm sm:p-5 lg:grid-cols-2">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[150px_1fr]">
              <dt className="text-muted">{t("method.standard")}</dt><dd>{t("method.standardValue")}</dd>
              <dt className="text-muted">{t("method.boundary")}</dt><dd>{t("method.boundaryValue", { n: sites.length })}{sites.length > 0 && <span className="text-muted"> · {sites.map((s) => s.name).join(", ")}</span>}</dd>
              <dt className="text-muted">{t("method.period")}</dt><dd>{period.label} · {period.start} → {period.end}</dd>
              <dt className="text-muted">{t("method.country")}</dt><dd>{profile.country}</dd>
              <dt className="text-muted">{t("method.scope2")}</dt><dd>{t("method.scope2Value")}</dd>
              <dt className="text-muted">{t("tierMix")}</dt>
              <dd>
                <ul className="space-y-1">
                  {(["primary", "secondary", "estimated"] as const).map((k) => (
                    <li key={k} className="flex items-start gap-2"><span className={clsx("pill shrink-0", TIER_PILL[k])}>{t(`tier.${k}`)}</span><span className="text-muted">{t(`tierWhy.${k}`)}</span></li>
                  ))}
                </ul>
              </dd>
            </dl>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("method.sources", { n: view.factors.length })}</div>
              <ul className="mt-2 divide-y divide-line">
                {view.factors.map((f) => (
                  <li key={f.factor_id} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{energyLabel(f.energy_type)}{f.factor_gas ? ` · ${f.factor_gas}` : ""}</span>
                      <span className="tabular text-muted">{f.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })} kgCO2e/{f.unit}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {f.factor_source_name} · {f.factor_region || f.factor_country} {f.factor_year} · {t("factorCard.vintage")} {f.factor_vintage}
                      {f.factor_source_url && <a href={f.factor_source_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-signal-ink underline-offset-2 hover:underline">{t("factorCard.open")}<ExternalLink className="size-3" aria-hidden /></a>}
                    </div>
                  </li>
                ))}
              </ul>
              {assumptions.length > 0 && (
                <>
                  <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">{t("assumptions")} · {assumptions.length}</div>
                  <ul className="mt-2 space-y-2 text-xs">
                    {assumptions.map((a) => <li key={a.id}><span className="text-muted">A ·</span> {a.answer} <span className="text-muted">— {a.method}</span></li>)}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Filters + table ------------------------------------------------------------------ */}
      <section aria-labelledby="lines-h" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="lines-h" className="font-display text-xl text-balance">{t("lines.title", { n: view.headline.length })}</h2>
          <span className="flex-1" />
          <button className="btn btn-ghost btn-sm gap-1.5" onClick={() => setSort((s) => (s === "period" ? "emissions" : "period"))} aria-label={t("lines.sortBy", { key: t(`lines.sort.${sort === "period" ? "emissions" : "period"}`) })}>
            <ArrowUpDown className="size-3.5" aria-hidden />{t(`lines.sort.${sort}`)}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("lines.filters")}>
          <button className={clsx("pill min-h-8 px-3", !filterType ? "bg-ink text-raised" : "pill-muted")} aria-pressed={!filterType} onClick={() => setFilterType(null)}>{t("lines.all")}</button>
          {view.types.map((ty) => (
            <button key={ty} className={clsx("pill min-h-8 px-3", filterType === ty ? "bg-ink text-raised" : "pill-muted")} aria-pressed={filterType === ty} onClick={() => setFilterType(filterType === ty ? null : ty)}>{energyLabel(ty)}</button>
          ))}
          <span className="mx-1 w-px bg-line-strong" aria-hidden />
          {(["primary", "secondary", "estimated"] as const).filter((k) => (tot.tier_mix[k] ?? 0) > 0).map((k) => (
            <button key={k} className={clsx("pill min-h-8 px-3", filterTier === k ? "bg-ink text-raised" : TIER_PILL[k])} aria-pressed={filterTier === k} onClick={() => setFilterTier(filterTier === k ? null : k)}>{t(`tier.${k}`)}</button>
          ))}
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{t("columns.period")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("columns.type")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("columns.quantity")}</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t("columns.factor")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("columns.emissions")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("columns.tier")}</th>
              </tr>
            </thead>
            {view.groups.map((g) => (
              <tbody key={`${g.scope}-${g.type}`}>
                <tr className="border-t border-line-strong bg-sunken/40">
                  <th scope="rowgroup" colSpan={4} className="px-3 py-1.5 text-left text-xs font-semibold">
                    <span className="pill pill-muted mr-2">{t("scopeN", { n: g.scope })}</span>{energyLabel(g.type)} <span className="font-normal text-muted">· {g.lines.length}</span>
                  </th>
                  <td className="px-3 py-1.5 text-right text-xs font-semibold tabular">{t1(g.kg)}</td>
                  <td />
                </tr>
                {g.lines.map((l) => (
                  <Row
                    key={l.id}
                    uid={uid}
                    pid={pid}
                    line={l}
                    market={view.marketByActivity[l.activity_line_id]}
                    activity={view.byActivity[l.activity_line_id]}
                    doc={docs[l.source_doc_id]}
                    assumptions={assumptions}
                    onChanged={load}
                    open={!!open[l.id]}
                    onToggle={() => setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))}
                  />
                ))}
              </tbody>
            ))}
          </table>
          {view.groups.length === 0 && <p className="p-6 text-center text-sm text-muted">{t("lines.noneMatch")}</p>}
        </div>
      </section>

      {/* By site ---------------------------------------------------------------------------- */}
      {Object.keys(tot.by_site).length > 1 && (
        <section className="card p-4 sm:p-5" aria-labelledby="site-h">
          <h2 id="site-h" className="font-display text-xl text-balance">{t("bySite")}</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">{t("site")}</th><th className="py-1 text-right font-medium">{t("scope1short")}</th><th className="py-1 text-right font-medium">{t("scope2short")}</th></tr></thead>
            <tbody>
              {Object.entries(tot.by_site).map(([id, v]) => (
                <tr key={id} className="border-t hairline"><td className="py-1.5">{siteName(id)}</td><td className="py-1.5 text-right tabular">{t1(v.scope1)}</td><td className="py-1.5 text-right tabular">{t1(v.scope2_location)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {snapshot.skipped.length > 0 && (
        <section className="card p-4 text-sm" aria-labelledby="skipped-h">
          <h2 id="skipped-h" className="flex items-center gap-2 font-medium">{t("skipped")}<span className="pill pill-attention tabular">{snapshot.skipped.length}</span></h2>
          <ul className="mt-1 list-disc pl-5 text-muted">{snapshot.skipped.map(([id, why]) => <li key={id}>{why}</li>)}</ul>
          <Link href={`/r/${request.id}/reconcile`} className="btn btn-secondary btn-sm mt-3">{t("fixInQuestions")}</Link>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-bar border-t hairline bg-paper/95 p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Link href={`/r/${request.id}/questionnaire`} className="btn w-full sm:w-auto">{t("next")}<ArrowRight className="size-4" aria-hidden /></Link>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  return <Inventory />;
}
