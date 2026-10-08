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
const LANGS = [["vi", "Tiếng Việt"], ["ja", "日本語"], ["en", "English"]] as const;

function Form({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("setup");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} lede={t("lede")} />

      <form onSubmit={save} className="card space-y-6 p-5 sm:p-6">
        <div>
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="organization" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="country">{t("country")}</label>
            <select id="country" className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="language">{t("language")}</label>
            <select id="language" className="input" aria-describedby="language-hint" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              {LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p id="language-hint" className="mt-1 text-xs text-muted">{t("languageHint")}</p>
          </div>
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
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input className="input" aria-label={`${t("siteName")} ${i + 1}`} placeholder={t("siteName")} value={s.name} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, name: e.target.value }; setF({ ...f, sites }); }} />
                <input className="input" aria-label={`${t("siteRegion")} ${i + 1}`} placeholder={t("siteRegion")} value={s.region} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, region: e.target.value }; setF({ ...f, sites }); }} />
                <input className="input sm:col-span-2" aria-label={`${t("siteAddress")} ${i + 1}`} placeholder={t("siteAddress")} value={s.address} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, address: e.target.value }; setF({ ...f, sites }); }} />
                <button type="button" className="btn btn-ghost btn-icon sm:col-start-3 sm:row-start-1" aria-label={t("removeSite", { n: i + 1 })} disabled={f.sites.length === 1} onClick={() => setF({ ...f, sites: f.sites.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm mt-2 gap-1.5" onClick={() => setF({ ...f, sites: [...f.sites, { name: "", country: f.country, region: "", address: "" }] })}>
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
