"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { Calculator, CircleAlert, ExternalLink, MapPin, Sun } from "lucide-react";
import { cn as clsx } from "@/lib/cn";
import { useRequest } from "@/components/request-context";
import { EmptyState, SkeletonList } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type AdvisorView, type LeverResult } from "@/lib/api";

const EASE = [0.23, 1, 0.32, 1] as const;
const tco2 = (kg: number, d = 1) => (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: d });

/** Electricity-side options draw on the same kWh, so together they cannot cut more than Scope 2 itself. */
const ELECTRIC = new Set(["solar", "led", "compressed_air"]);

function Comparison({ before, after, labels }: { before: number; after: number; labels: { before: string; after: string } }) {
  const reduce = useReducedMotion();
  const pct = before > 0 ? Math.max(0, Math.min(1, after / before)) : 1;
  return (
    <div className="space-y-2" aria-hidden>
      {[{ k: "before", v: 1, l: labels.before, n: before }, { k: "after", v: pct, l: labels.after, n: after }].map((r) => (
        <div key={r.k} className="grid grid-cols-[64px_1fr_72px] items-center gap-3 text-xs">
          <span className="text-muted">{r.l}</span>
          <div className="h-3 overflow-hidden rounded-full bg-sunken">
            <motion.div
              className={clsx("h-full origin-left rounded-full", r.k === "before" ? "bg-ink/70" : "bg-signal")}
              initial={false}
              animate={{ scaleX: r.v }}
              transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE }}
            />
          </div>
          <span className="tabular text-right">{tco2(r.n, 0)} t</span>
        </div>
      ))}
    </div>
  );
}

function SolarCard({ view, onRoof, busy, box }: { view: AdvisorView; onRoof: (m2: number) => void; busy: boolean; box: string }) {
  const t = useTranslations("reduce.solar");
  const locale = useLocale();
  const s = view.advice.solar;
  const [roof, setRoof] = useState(view.site?.roof_area_m2?.toString() ?? "");

  if (!view.located) return null;
  const roofForm = (
    <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(roof); if (n > 0) onRoof(n); }}>
      <label className="grow sm:grow-0">
        <span className="label">{t("roofLabel")}</span>
        <input className="input sm:w-44" inputMode="decimal" value={roof} onChange={(e) => setRoof(e.target.value)} placeholder="800" />
      </label>
      <button className="btn" disabled={busy || !(Number(roof) > 0)}>{t("roofSave")}</button>
    </form>
  );

  return (
    <section className={box} aria-labelledby="solar-h">
      <h2 id="solar-h" className="flex items-center gap-2 font-display text-xl"><Sun className="size-5 text-attention" aria-hidden />{t("title")}</h2>
      {view.error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-attention-bg p-3 text-sm text-attention"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{t("error", { msg: view.error })}</p>
      )}
      {s.available ? (
        <>
          <p className="mt-3 font-display text-2xl leading-snug text-balance">
            {t("headline", { pct: Math.round(s.share_of_electricity * 100), t: tco2(s.avoided_location_kg, 0) })}
            {s.payback_years != null && <span className="text-muted"> {t("payback", { years: s.payback_years.toLocaleString(undefined, { maximumFractionDigits: 1 }) })}</span>}
          </p>
          <p className={clsx("mt-3 inline-flex items-center gap-2 pill", s.precision === "solar_api" ? "pill-ok" : "pill-attention")}>
            {s.precision === "solar_api"
              ? t("measured", { quality: s.imagery_quality ?? "", year: s.imagery_date ? new Date(s.imagery_date).getFullYear() : "" })
              : t("estimated")}
          </p>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[170px_1fr]">
            <dt className="text-muted">{t("size")}</dt>
            <dd className="tabular">{t("sizeValue", { kwp: s.kwp.toLocaleString(undefined, { maximumFractionDigits: 1 }), kwh: Math.round(s.annual_kwh).toLocaleString(locale) })}{s.panels ? ` · ${t("panels", { n: s.panels })}` : ""}</dd>
            {s.capex != null && (<><dt className="text-muted">{t("cost")}</dt><dd className="tabular">{t("costValue", { amount: Math.round(s.capex).toLocaleString(locale), cur: s.currency ?? "" })}</dd></>)}
            {s.tariff != null && s.annual_saving != null && (<><dt className="text-muted">{t("saving")}</dt><dd className="tabular">{t("savingValue", { amount: Math.round(s.annual_saving).toLocaleString(locale), cur: s.currency ?? "", price: s.tariff.toLocaleString(undefined, { maximumFractionDigits: 2 }), source: s.tariff_source })}</dd></>)}
            <dt className="text-muted">{t("market")}</dt>
            <dd className="tabular">{t("marketValue", { t: tco2(s.avoided_market_kg, 0) })}</dd>
          </dl>
          {s.notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {s.precision === "pvgis_estimate" && roofForm}
        </>
      ) : s.needs_roof_area ? (
        <div className="mt-3">
          <p className="text-sm text-pretty text-muted">{t("roofHint")}</p>
          {roofForm}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("unavailable")}</p>
      )}
    </section>
  );
}

function LeverRow({ l, checked, onToggle }: { l: LeverResult; checked: boolean; onToggle: () => void }) {
  const t = useTranslations("reduce.levers");
  const [open, setOpen] = useState(false);
  const id = `lever-${l.id}`;
  const range = l.saved_max_kg - l.saved_min_kg > 50 ? t("range", { lo: tco2(l.saved_min_kg), hi: tco2(l.saved_max_kg) }) : t("single", { n: tco2(l.saved_mid_kg) });
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" className="mt-1 size-4 accent-[var(--signal)]" checked={checked} disabled={!l.beneficial} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 font-medium">
            {l.name}
            <span className="pill pill-muted">{t(`cost.${l.cost_class}`)}</span>
            {l.basis === "market" && <span className="pill pill-secondary">{t("marketOnly")}</span>}
          </label>
          {l.beneficial ? (
            <div className="tabular text-sm text-signal-ink">{range}</div>
          ) : (
            <div className="text-sm text-danger">{t("worse", { n: tco2(-l.saved_mid_kg) })}</div>
          )}
          <button className="mt-1 text-xs text-muted underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t("how")}</button>
          {open && (
            <div className="mt-2 space-y-1 text-xs text-muted">
              <p>{l.note}</p>
              <p>{l.cost_note}</p>
              <p>
                {l.source_url ? (
                  <a href={l.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-signal-ink underline-offset-2 hover:underline">{l.source_name}<ExternalLink className="size-3" aria-hidden /></a>
                ) : l.source_name}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The reduction plan: where the site is, rooftop solar sized to it, the other
 * levers to tick, and what they would save together. Used as the /reduce page and
 * inside the inventory's "Where you could cut emissions" dialog; `variant="dialog"`
 * sets its cards on the sunken surface so they do not float on the dialog's card.
 */
export function ReducePlanner({ variant = "page" }: { variant?: "page" | "dialog" }) {
  const t = useTranslations("reduce");
  const { uid, profile, period, request } = useRequest();
  const toast = useToast();
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<AdvisorView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["solar"]));

  const load = useCallback(async (sid?: string) => {
    try {
      const v = await api.advisor(uid, period.id, sid);
      setView(v);
      setMissing(false);
      setAddress((a) => a || v.site?.address || "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setMissing(true);
      else toast(e instanceof Error ? e.message : String(e), "danger");
    }
  }, [uid, period.id, toast]);

  useEffect(() => { load(siteId); }, [load, siteId]);
  // A different site starts from its own address, not the previous one's.
  useEffect(() => { setAddress(""); }, [siteId]);

  const activeSite = view?.site ?? null;

  async function locate(body: { address?: string; roof_area_m2?: number }) {
    if (!activeSite) return;
    setBusy(true);
    try {
      await api.locateSite(uid, activeSite.id, body);
      await load(activeSite.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  }

  const scenario = useMemo(() => {
    if (!view) return null;
    const a = view.advice;
    const base = a.scope1_kg + a.scope2_location_kg;
    let electric = 0;
    let other = 0;
    if (view.advice.solar.available && picked.has("solar")) electric += a.solar.avoided_location_kg;
    for (const l of a.levers) {
      if (!picked.has(l.id) || !l.beneficial || l.basis === "market") continue;
      if (ELECTRIC.has(l.id)) electric += l.saved_mid_kg; else other += l.saved_mid_kg;
    }
    electric = Math.min(electric, a.scope2_location_kg);
    const rec = a.levers.find((l) => l.id === "rec" && picked.has("rec"));
    return { base, saved: electric + other, after: Math.max(0, base - electric - other), recKg: rec ? rec.saved_mid_kg : 0 };
  }, [view, picked]);

  if (missing) {
    return (
      <EmptyState icon={Calculator} title={t("needInventory")} body={t("needInventoryBody")} action={variant === "page" ? <Link className="btn" href={`/r/${request.id}/inventory`}>{t("toInventory")}</Link> : undefined} />
    );
  }
  if (!view || !scenario) return <SkeletonList rows={3} />;

  const sites = profile.sites;
  const box = variant === "dialog" ? "card-sunken p-4 sm:p-5" : "card p-4 sm:p-5";
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pct = scenario.base > 0 ? Math.round((scenario.saved / scenario.base) * 100) : 0;

  return (
    <div className="space-y-4 sm:space-y-5">

      {sites.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("sites")}>
          {sites.map((s) => (
            <button key={s.id} className={clsx("pill min-h-8 px-3", activeSite?.id === s.id ? "bg-ink text-raised" : "pill-muted")} aria-pressed={activeSite?.id === s.id} onClick={() => setSiteId(s.id)}>{s.name}</button>
          ))}
        </div>
      )}

      <section className={box} aria-labelledby="loc-h">
        <h2 id="loc-h" className="flex items-center gap-2 font-display text-xl"><MapPin className="size-5 text-muted" aria-hidden />{t("locate.title")}</h2>
        <p className="mt-1 text-sm text-pretty text-muted">{t("locate.hint")}</p>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (address.trim()) locate({ address }); }}>
          <label className="min-w-0 grow">
            <span className="label">{t("locate.address")}</span>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("locate.placeholder")} />
          </label>
          <button className="btn" disabled={busy || !address.trim()}>{view.located ? t("locate.again") : t("locate.find")}</button>
        </form>
        {view.located && activeSite?.formatted_address && (
          <p className="mt-3 text-sm"><span className="text-muted">{t("locate.matched")}</span> {activeSite.formatted_address}</p>
        )}
      </section>

      <SolarCard key={`${activeSite?.id}-${view.advice.solar.precision}-${view.advice.solar.needs_roof_area}`} view={view} box={box} busy={busy} onRoof={(m2) => locate({ roof_area_m2: m2 })} />

      {view.advice.levers.length > 0 && (
        <section className={box} aria-labelledby="lev-h">
          <h2 id="lev-h" className="font-display text-xl">{t("levers.title")}</h2>
          <ul className="mt-1 divide-y divide-line">
            {view.advice.solar.available && (
              <li className="py-3">
                <div className="flex items-start gap-3">
                  <input id="lever-solar" type="checkbox" className="mt-1 size-4 accent-[var(--signal)]" checked={picked.has("solar")} onChange={() => toggle("solar")} />
                  <label htmlFor="lever-solar" className="font-medium">{t("solar.title")} <span className="tabular text-sm font-normal text-signal-ink">· {tco2(view.advice.solar.avoided_location_kg)} t</span></label>
                </div>
              </li>
            )}
            {view.advice.levers.map((l) => <LeverRow key={l.id} l={l} checked={picked.has(l.id)} onToggle={() => toggle(l.id)} />)}
          </ul>
        </section>
      )}

      <section className={box} aria-labelledby="sc-h" aria-live="polite">
        <h2 id="sc-h" className="font-display text-xl">{t("scenario.title")}</h2>
        <div className="mt-3"><Comparison before={scenario.base} after={scenario.after} labels={{ before: t("scenario.before"), after: t("scenario.after") }} /></div>
        <p className="mt-3 text-sm">{t("scenario.saves", { t: tco2(scenario.saved, 0), pct })}</p>
        {scenario.recKg > 0 && <p className="mt-1 text-xs text-muted">{t("scenario.market", { t: tco2(scenario.recKg, 0) })}</p>}
      </section>

      <p className="text-xs text-pretty text-muted">{t("disclaimer")}</p>
    </div>
  );
}
