"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { api, type SupplierProfile } from "@/lib/api";

const COUNTRIES = ["VN", "JP", "SG", "AU", "TH", "ID", "IN"];
const LANGS = [["vi", "Tiếng Việt"], ["ja", "日本語"], ["en", "English"]] as const;

function Form({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("setup");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    name: profile?.name ?? "",
    country: profile?.country ?? "VN",
    language: profile?.language ?? locale,
    fiscal_year_start: profile?.fiscal_year_start ?? "2025-01-01",
    fiscal_year_end: profile?.fiscal_year_end ?? "2025-12-31",
    sites: profile?.sites.map((s) => ({ name: s.name, country: s.country, region: s.region ?? "" })) ?? [{ name: "", country: profile?.country ?? "VN", region: "" }],
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
        sites: f.sites.filter((s) => s.name.trim()).map((s) => ({ name: s.name, country: s.country || f.country, region: s.region || null })),
      });
      setSaved(true);
      router.push("/documents");
    } finally {
      setBusy(false);
    }
  }

  void uid;
  return (
    <form onSubmit={save} className="card space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("lede")}</p>
      </div>

      <div>
        <label className="label">{t("name")}</label>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">{t("country")}</label>
          <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
            {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t("language")}</label>
          <select className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
            {LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t("fyStart")}</label>
          <input className="input" type="date" value={f.fiscal_year_start} onChange={(e) => setF({ ...f, fiscal_year_start: e.target.value })} required />
        </div>
        <div>
          <label className="label">{t("fyEnd")}</label>
          <input className="input" type="date" value={f.fiscal_year_end} onChange={(e) => setF({ ...f, fiscal_year_end: e.target.value })} required />
        </div>
      </div>

      <div>
        <label className="label">{t("sites")}</label>
        <div className="space-y-2">
          {f.sites.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder={t("siteName")} value={s.name} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, name: e.target.value }; setF({ ...f, sites }); }} />
              <input className="input" placeholder={t("siteRegion")} value={s.region} onChange={(e) => { const sites = [...f.sites]; sites[i] = { ...s, region: e.target.value }; setF({ ...f, sites }); }} />
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm text-[var(--accent)] underline-offset-4 hover:underline" onClick={() => setF({ ...f, sites: [...f.sites, { name: "", country: f.country, region: "" }] })}>
          + {t("addSite")}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <label className="label">{t("revenue")}</label>
          <input className="input" inputMode="decimal" value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} />
        </div>
        <div>
          <label className="label">{t("currency")}</label>
          <input className="input" placeholder="VND" value={f.revenue_currency} onChange={(e) => setF({ ...f, revenue_currency: e.target.value.toUpperCase() })} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={busy}>{t("save")}</button>
        {saved && <span className="text-sm text-[var(--accent)]">{t("saved")}</span>}
      </div>
    </form>
  );
}

export default function SetupPage() {
  return (
    <Shell>
      <RequireAuth>{(profile, uid) => <Form profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
