"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpDown, Calculator, ChevronDown, ExternalLink, FileText, Info, Pencil, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { EmptyState, MixBar, PageTitle, SkeletonList, Stat, TIER_BAR, TIER_PILL } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type ActivityLine, type Assumption, type DocumentRecord, type InventoryLine, type Snapshot, type SupplierProfile } from "@/lib/api";
import { ENERGY_ORDER, energyLabel, shortMonth } from "@/lib/coverage";

const t1 = (kg: number, d = 2) => (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: d });
const num = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });

const shortDate = (iso: string, locale?: string) => new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "2-digit", month: "short" });

// --- lineage pieces -------------------------------------------------------------

function SourceThumb({ uid, docId, doc }: { uid: string; docId: string; doc?: DocumentRecord }) {
  const t = useTranslations("inventory");
  const [src, setSrc] = useState<string | null>(null);
  const isImage = !!doc && doc.mime_type.startsWith("image/");
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    api.documentFileUrl(uid, docId).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [uid, docId, isImage]);

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

function Calculation({ uid, line, market, activity, doc, assumptions, onChanged }: { uid: string; line: InventoryLine; market?: InventoryLine; activity?: ActivityLine; doc?: DocumentRecord; assumptions: Assumption[]; onChanged: () => void }) {
  const t = useTranslations("inventory");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.quantity));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const asms = assumptions.filter((a) => line.assumption_ids.includes(a.id));
  const notes = (line.activity_notes || activity?.notes || "").split(" | ").map((s) => s.trim()).filter(Boolean);
  const where = line.factor_region || line.factor_country;

  async function save() {
    setBusy(true);
    try {
      await api.patchLine(uid, line.activity_line_id, { quantity: Number(qty) });
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

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <ol className="space-y-4">
        <Step n={1} title={t("step.document")}>
          <div className="flex items-start gap-3">
            <SourceThumb uid={uid} docId={line.source_doc_id} doc={doc} />
            <div className="min-w-0">
              {doc?.filename && <div className="font-medium">{doc.filename}</div>}
              <div className="font-mono text-xs text-muted">{line.source_doc_id}</div>
              {notes.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {notes.map((n, i) => <li key={i}>· {n}</li>)}
                </ul>
              )}
            </div>
          </div>
        </Step>

        <Step n={2} title={t("step.quantity")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-2xl tabular">{num(line.quantity, 2)}</span>
            <span className="text-muted">{line.unit}</span>
            <span className={clsx("pill", TIER_PILL[line.tier])}>{t(`tier.${line.tier}`)}</span>
            <span className="text-xs text-muted">{t(`tierWhy.${line.tier}`)}</span>
          </div>
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
                <button className="btn btn-ghost btn-sm gap-1.5" onClick={() => setEditing(true)}><Pencil className="size-3.5" aria-hidden />{t("correct")}</button>
              )}
            </div>
          )}
        </Step>

        <Step n={3} title={t("step.factor")}>
          <div className="card-sunken p-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-2xl tabular">{line.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span className="text-sm text-muted">kgCO2e / {line.unit}</span>
              {line.factor_gas && <span className="pill pill-muted">{line.factor_gas}</span>}
            </div>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[110px_1fr]">
              <dt className="text-muted">{t("factorCard.source")}</dt>
              <dd className="break-words">
                {line.factor_source_name}
                {line.factor_source_url && (
                  <a href={line.factor_source_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-signal-ink underline-offset-2 hover:underline">
                    {t("factorCard.open")}<ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </dd>
              <dt className="text-muted">{t("factorCard.vintage")}</dt>
              <dd>{line.factor_vintage} · {t("factorCard.year", { year: line.factor_year ?? "" })}</dd>
              <dt className="text-muted">{t("factorCard.geography")}</dt>
              <dd>{where} · {t(`method.${line.method}`)}</dd>
              <dt className="text-muted">{t("factorCard.id")}</dt>
              <dd className="font-mono">{line.factor_id}</dd>
            </dl>
            {(!line.exact_year || !line.exact_region || line.fell_back_to) && (
              <ul className="mt-2 space-y-1 border-t hairline pt-2 text-xs text-attention">
                {!line.exact_year && <li>· {t("factorCard.nearestYear", { year: line.factor_year ?? "" })}</li>}
                {!line.exact_region && <li>· {t("factorCard.nationalFallback")}</li>}
                {line.fell_back_to && <li>· {t("factorCard.marketFallback")}</li>}
              </ul>
            )}
          </div>
        </Step>

        <Step n={4} title={t("step.result")}>
          <div className="font-mono text-sm">
            {num(line.quantity, 2)} {line.unit} × {line.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })} kgCO2e/{line.unit} = <b className="text-ink">{num(line.kg_co2e, 1)} kgCO2e</b> = <b className="text-signal-ink">{t1(line.kg_co2e, 3)} tCO2e</b>
          </div>
          {market && (
            <div className="mt-1 font-mono text-xs text-muted">
              {t("scope2mkt")}: {num(market.quantity, 2)} {market.unit} × {market.factor_value.toLocaleString(undefined, { maximumFractionDigits: 4 })} = {t1(market.kg_co2e, 3)} tCO2e
            </div>
          )}
        </Step>
      </ol>

      <aside className="space-y-3">
        {asms.length > 0 ? (
          <div className="card-sunken p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("assumptions")}</div>
            {asms.map((a) => (
              <div key={a.id} className="mt-2 space-y-1">
                <div><span className="text-muted">Q ·</span> {a.question}</div>
                <div><span className="text-muted">A ·</span> {a.answer}</div>
                <div className="text-xs text-muted">{a.method}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card-sunken p-3 text-xs text-muted">{t("noAssumptions")}</div>
        )}
        <div className="text-xs text-muted">{line.period_start} → {line.period_end}{line.site_id ? ` · ${line.site_id}` : ""}</div>
      </aside>

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

function Row({ uid, line, market, activity, doc, assumptions, onChanged, open, onToggle }: { uid: string; line: InventoryLine; market?: InventoryLine; activity?: ActivityLine; doc?: DocumentRecord; assumptions: Assumption[]; onChanged: () => void; open: boolean; onToggle: () => void }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const id = `calc-${line.id.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <>
      <tr className={clsx("border-t hairline", open && "bg-sunken/60")}>
        <td className="px-3 py-2">
          <button className="flex min-h-9 items-center gap-2 text-left text-xs text-muted" aria-expanded={open} aria-controls={id} onClick={onToggle}>
            <ChevronDown className={clsx("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
            <span className="whitespace-nowrap">{line.period_start === line.period_end ? shortDate(line.period_start, locale) : `${shortDate(line.period_start, locale)} – ${shortDate(line.period_end, locale)}`}</span>
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
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <Calculation uid={uid} line={line} market={market} activity={activity} doc={doc} assumptions={assumptions} onChanged={onChanged} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// --- chart -----------------------------------------------------------------------

function MonthlyChart({ byMonth }: { byMonth: Record<string, { scope1: number; scope2_location: number; estimated: number }> }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const months = Object.keys(byMonth).sort();
  if (!months.length) return null;
  const max = Math.max(...months.map((m) => byMonth[m].scope1 + byMonth[m].scope2_location), 1);
  const W = 100 / months.length;
  return (
    <figure className="card p-4 sm:p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-xl">{t("chart.title")}</span>
        <span className="flex flex-wrap gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-ink" />{t("scope1short")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-signal" />{t("scope2short")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-attention-strong" />{t("tier.estimated")}</span>
        </span>
      </figcaption>
      <svg viewBox="0 0 100 40" className="mt-3 h-40 w-full" role="img" aria-label={months.map((m) => `${shortMonth(m, locale)}: ${t1(byMonth[m].scope1 + byMonth[m].scope2_location)} tCO2e`).join(", ")}>
        {months.map((m, i) => {
          const b = byMonth[m];
          const h1 = (b.scope1 / max) * 34, h2 = (b.scope2_location / max) * 34, he = (b.estimated / max) * 34;
          const x = i * W + W * 0.15, w = W * 0.7;
          return (
            <g key={m}>
              <title>{`${shortMonth(m, locale)} · ${t("scope1short")} ${t1(b.scope1)} · ${t("scope2short")} ${t1(b.scope2_location)}${b.estimated ? ` · ${t("tier.estimated")} ${t1(b.estimated)}` : ""} tCO2e`}</title>
              <rect x={x} y={36 - h2} width={w} height={h2} fill="var(--signal)" rx={0.4} />
              <rect x={x} y={36 - h2 - h1} width={w} height={h1} fill="var(--ink)" rx={0.4} />
              {he > 0 && <rect x={x} y={36 - he} width={w} height={he} fill="var(--attention-strong)" opacity={0.85} rx={0.4} />}
              <text x={x + w / 2} y={39.5} fontSize={2.6} textAnchor="middle" fill="var(--muted)">{shortMonth(m, locale)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// --- page --------------------------------------------------------------------------

type SortKey = "period" | "emissions";

function Inventory({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
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

  const load = useCallback(() => api.inventory(uid).then(setData), [uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.listDocuments(uid).then((r) => setDocs(Object.fromEntries(r.documents.map((d) => [d.id, d])))).catch(() => {});
  }, [uid]);

  async function compute() {
    setBusy(true);
    try {
      await api.compute(uid);
      await load();
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
        <EmptyState icon={Calculator} title={t("notComputed")} body={t("notComputedBody")} action={<button className="btn" onClick={compute} disabled={busy}><Calculator className="size-4" aria-hidden />{t("compute")}</button>} />
      </div>
    );
  }

  const tot = snapshot.totals;
  const total = tot.scope1_kg + tot.scope2_location_kg;
  const share = (kg: number) => (total ? `${((kg / total) * 100).toFixed(0)}%` : "—");
  const tierSegs = Object.entries(tot.tier_mix).map(([k, v]) => ({ key: k, share: v, className: TIER_BAR[k] ?? "bg-muted", label: t(`tier.${k}`) }));
  const sites = profile?.sites ?? [];
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-6 pb-16">
      <PageTitle
        title={t("title")}
        lede={t("lede")}
        aside={<button className="btn btn-secondary btn-sm gap-1.5" onClick={compute} disabled={busy}><RefreshCw className={clsx("size-3.5", busy && "animate-spin")} aria-hidden />{t("compute")}</button>}
      />

      {/* Headline band --------------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("scope1")} value={tot.scope1_kg / 1000} unit={t("tonnes")} sub={t("shareOfTotal", { pct: share(tot.scope1_kg) })} />
        <Stat label={t("scope2loc")} value={tot.scope2_location_kg / 1000} unit={t("tonnes")} sub={t("shareOfTotal", { pct: share(tot.scope2_location_kg) })} />
        <Stat label={t("scope2mkt")} value={tot.scope2_market_kg / 1000} unit={t("tonnes")} tone="muted" sub={t("marketNote")} />
        <Stat label={t("total")} value={total / 1000} unit={t("tonnes")} tone="signal" sub={<><MixBar segments={tierSegs} className="mt-1" /><span className="mt-1 block">{tierSegs.map((s) => `${s.label} ${(s.share * 100).toFixed(1)}%`).join(" · ")}</span></>} />
      </div>

      <MonthlyChart byMonth={tot.by_month ?? {}} />

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
              <dt className="text-muted">{t("method.period")}</dt><dd>{profile?.fiscal_year_start} → {profile?.fiscal_year_end}</dd>
              <dt className="text-muted">{t("method.country")}</dt><dd>{profile?.country}</dd>
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
          <h2 id="lines-h" className="font-display text-xl">{t("lines.title", { n: view.headline.length })}</h2>
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
          <h2 id="site-h" className="font-display text-xl">{t("bySite")}</h2>
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
        <section className="card border-attention-strong/40 p-4 text-sm" aria-labelledby="skipped-h">
          <h2 id="skipped-h" className="font-medium">{t("skipped")} · {snapshot.skipped.length}</h2>
          <ul className="mt-1 list-disc pl-5 text-muted">{snapshot.skipped.map(([id, why]) => <li key={id}>{why}</li>)}</ul>
          <Link href="/reconcile" className="btn btn-secondary btn-sm mt-3">{t("fixInQuestions")}</Link>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t hairline bg-paper/95 p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Link href="/questionnaire" className="btn w-full sm:w-auto">{t("next")}<ArrowRight className="size-4" aria-hidden /></Link>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Shell wide>
      <RequireAuth>{(profile, uid) => <Inventory profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
