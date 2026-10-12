"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { PageTitle } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type SupplierProfile } from "@/lib/api";

const COUNTRIES = ["VN", "JP", "SG", "AU", "TH", "ID", "IN"];
/** Australia is the only country with state-level grid factors; a state outside the six falls back to the national figure. */
const AU_STATES: [string, string][] = [["AU-NSW", "New South Wales"], ["AU-VIC", "Victoria"], ["AU-QLD", "Queensland"], ["AU-SA", "South Australia"], ["AU-WA", "Western Australia"], ["AU-TAS", "Tasmania"]];

function Form({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("setup");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const countryName = new Intl.DisplayNames([locale], { type: "region" });
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [f, setF] = useState({
    name: profile?.name ?? "",
    country: profile?.country ?? "VN",
    fiscal_year_start: profile?.fiscal_year_start ?? "2025-01-01",
    fiscal_year_end: profile?.fiscal_year_end ?? "2025-12-31",
    sites: profile?.sites.map((s) => ({ name: s.name, region: s.region ?? "" })) ?? [{ name: "", region: "" }],
    sector: profile?.sector ?? "",
    revenue: profile?.revenue?.toString() ?? "",
    revenue_currency: profile?.revenue_currency ?? "",
    headcount: profile?.headcount?.toString() ?? "",
    nace_code: profile?.nace_code ?? "",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.upsertSupplier({
        name: f.name,
        country: f.country,
        language: locale,   // the questions on the next steps follow the language the app is shown in
        fiscal_year_start: f.fiscal_year_start,
        fiscal_year_end: f.fiscal_year_end,
        sector: f.sector,
        revenue: f.revenue ? Number(f.revenue) : null,
        revenue_currency: f.revenue_currency || null,
        headcount: f.headcount ? Math.round(Number(f.headcount)) : null,
        nace_code: f.nace_code.trim(),
        // No address here: it is entered on the Reduce page, where it is used. Leaving it out keeps any stored one.
        sites: f.sites.filter((s) => s.name.trim()).map((s) => ({ name: s.name, country: f.country, region: f.country === "AU" ? s.region || null : null })),
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

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} lede={t("lede")} />

      <form onSubmit={save} className="card space-y-6 p-5 sm:p-6">
        <div>
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="organization" />
        </div>

        <div>
          <label className="label" htmlFor="country">{t("country")}</label>
          <select id="country" className="input" aria-describedby="country-hint" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{countryName.of(c) ?? c}</option>)}
          </select>
          <p id="country-hint" className="mt-1 text-xs text-muted">{t("countryHint")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="fyStart">{t("fyStart")}</label>
            <input id="fyStart" className="input" type="date" value={f.fiscal_year_start} onChange={(e) => setF({ ...f, fiscal_year_start: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="fyEnd">{t("fyEnd")}</label>
            <input id="fyEnd" className="input" type="date" value={f.fiscal_year_end} onChange={(e) => setF({ ...f, fiscal_year_end: e.target.value })} required />
          </div>
        </div>

        <fieldset>
          <legend className="label">{t("sites")}</legend>
          <p className="mb-2 text-xs text-muted">{t("sitesHint")}</p>
          <div className="space-y-2">
            {f.sites.map((s, i) => (
              <div key={i} className={f.country === "AU" ? "grid gap-2 sm:grid-cols-[1fr_1fr_auto]" : "grid gap-2 sm:grid-cols-[1fr_auto]"}>
                <input className="input" aria-label={`${t("siteName")} ${i + 1}`} placeholder={t("siteName")} value={s.name} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, name: e.target.value }; setF({ ...f, sites }); }} />
                {f.country === "AU" && (
                  <select className="input" aria-label={`${t("siteState")} ${i + 1}`} value={s.region} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, region: e.target.value }; setF({ ...f, sites }); }}>
                    <option value="">{t("siteStateOther")}</option>
                    {AU_STATES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
                <button type="button" className="btn btn-ghost btn-icon" aria-label={t("removeSite", { n: i + 1 })} disabled={f.sites.length === 1} onClick={() => setF({ ...f, sites: f.sites.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm mt-2 gap-1.5" onClick={() => setF({ ...f, sites: [...f.sites, { name: "", region: "" }] })}>
            <Plus className="size-4" aria-hidden /> {t("addSite")}
          </button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div>
            <label className="label" htmlFor="revenue">{t("revenue")}</label>
            <input id="revenue" className="input tabular" inputMode="decimal" value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="currency">{t("currency")}</label>
            <input id="currency" className="input" placeholder="VND" value={f.revenue_currency} onChange={(e) => setF({ ...f, revenue_currency: e.target.value.toUpperCase() })} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="headcount">{t("headcount")}</label>
            <input id="headcount" className="input tabular" inputMode="numeric" aria-describedby="headcount-hint" value={f.headcount} onChange={(e) => setF({ ...f, headcount: e.target.value.replace(/[^0-9]/g, "") })} />
            <p id="headcount-hint" className="mt-1 text-xs text-muted">{t("headcountHint")}</p>
          </div>
          <div>
            <label className="label" htmlFor="nace">{t("nace")}</label>
            <input id="nace" className="input" placeholder="C.13.20" aria-describedby="nace-hint" value={f.nace_code} onChange={(e) => setF({ ...f, nace_code: e.target.value })} />
            <p id="nace-hint" className="mt-1 text-xs text-muted">{t("naceHint")}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn" disabled={busy}>{t("save")}</button>
        </div>
      </form>

      {profile && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
          <div>
            <div className="font-medium">{t("startOver")}</div>
            <div className="mt-0.5 text-muted">{t("startOverLede")}</div>
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)} disabled={busy}>{t("startOver")}</button>
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
      <RequireAuth>{(profile, uid) => <Form profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
