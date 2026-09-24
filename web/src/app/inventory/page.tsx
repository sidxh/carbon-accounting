"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { api, type ActivityLine, type Assumption, type DocumentRecord, type InventoryLine, type Snapshot, type SupplierProfile } from "@/lib/api";

const t1 = (kg: number) => (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** The bill a line came from, as a small image; a badge for PDFs; a note for estimated lines. */
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
    return <div className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-[var(--warn-bg)] px-1 text-center text-[10px] leading-tight text-[var(--warn)]">{t("fromAssumption")}</div>;
  }
  if (!isImage) {
    return <div className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-[#eeeeea] text-xs font-semibold text-[var(--muted)]">PDF</div>;
  }
  // A blob: URL from an authenticated fetch; next/image cannot optimise it.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-20 w-16 shrink-0 rounded-lg bg-[#eeeeea]" />;
}

function Headline({ label, kg }: { label: string; kg: number }) {
  const t = useTranslations("inventory");
  return (
    <div className="card p-4">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{t1(kg)} <span className="text-sm font-normal text-[var(--muted)]">{t("tonnes")}</span></div>
    </div>
  );
}

const shortDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

function Row({ uid, line, market, activity, doc, assumptions, onChanged }: { uid: string; line: InventoryLine; market?: InventoryLine; activity?: ActivityLine; doc?: DocumentRecord; assumptions: Assumption[]; onChanged: () => void }) {
  const t = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.quantity));
  const [busy, setBusy] = useState(false);
  const asms = assumptions.filter((a) => line.assumption_ids.includes(a.id));

  async function save() {
    setBusy(true);
    try {
      await api.patchLine(uid, line.activity_line_id, { quantity: Number(qty) });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="cursor-pointer border-t border-[var(--line)] hover:bg-[#fafaf8]" onClick={() => setOpen(!open)}>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
          {line.period_start === line.period_end ? shortDate(line.period_start) : `${shortDate(line.period_start)} – ${shortDate(line.period_end)}`}
        </td>
        <td className="px-3 py-2 capitalize">{line.energy_type.replace("_", " ")}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs text-[var(--muted)]">{line.unit}</span></td>
        <td className="px-3 py-2 text-right font-medium tabular-nums">{t1(line.kg_co2e)}</td>
        <td className="px-3 py-2 text-right"><span className={`pill ${line.tier === "primary" ? "pill-ok" : line.tier === "estimated" ? "pill-warn" : "pill-muted"}`}>{t(`tier.${line.tier}`)}</span></td>
      </tr>
      {open && (
        <tr className="bg-[#fafaf8]">
          <td colSpan={5} className="px-4 py-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{t("lineage")}</div>
            <dl className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr]">
              <dt className="text-[var(--muted)]">{t("document")}</dt>
              <dd className="flex items-start gap-3">
                <SourceThumb uid={uid} docId={line.source_doc_id} doc={doc} />
                <div className="min-w-0 break-words text-xs">
                  {doc?.filename && <div className="font-medium">{doc.filename}</div>}
                  <div className="font-mono text-[var(--muted)]">{line.source_doc_id}</div>
                  {activity?.notes && <div className="mt-0.5 text-[var(--muted)]">{activity.notes}</div>}
                </div>
              </dd>
              <dt className="text-[var(--muted)]">{t("factor")}</dt>
              <dd className="break-words text-xs">
                <b>{line.factor_value}</b> kgCO2e/{line.unit} — {line.factor_citation}
                {market && (
                  <div className="mt-1 text-[var(--muted)]">
                    {t("scope2mkt")}: <b>{t1(market.kg_co2e)}</b> {t("tonnes")} · {market.factor_citation}
                  </div>
                )}
              </dd>
              {asms.length > 0 && (
                <>
                  <dt className="text-[var(--muted)]">{t("assumptions")}</dt>
                  <dd className="text-xs">{asms.map((a) => <div key={a.id}><b>Q:</b> {a.question} <b>A:</b> {a.answer} <span className="text-[var(--muted)]">— {a.method}</span></div>)}</dd>
                </>
              )}
            </dl>
            {line.basis !== "market" && (
              <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {editing ? (
                  <>
                    <input className="input max-w-[160px]" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
                    <span className="text-sm">{line.unit}</span>
                    <button className="btn px-4 py-1.5 text-sm" onClick={save} disabled={busy}>{t("save")}</button>
                    <button className="btn btn-secondary px-4 py-1.5 text-sm" onClick={() => setEditing(false)}>{t("cancel")}</button>
                  </>
                ) : (
                  <button className="text-sm text-[var(--accent)] underline-offset-4 hover:underline" onClick={() => setEditing(true)}>{t("correct")}</button>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Inventory({ uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("inventory");
  const [data, setData] = useState<{ lines: InventoryLine[]; snapshot: Snapshot | null; assumptions: Assumption[]; activityLines: ActivityLine[] } | null>(null);
  const [docs, setDocs] = useState<Record<string, DocumentRecord>>({});
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const load = useCallback(() => api.inventory(uid).then(setData), [uid]);
  useEffect(() => { load(); }, [load]);
  // Document metadata (filename, mime type) for the lineage thumbnails.
  useEffect(() => {
    api.listDocuments(uid).then((r) => setDocs(Object.fromEntries(r.documents.map((d) => [d.id, d])))).catch(() => {});
  }, [uid]);

  async function compute() {
    setBusy(true);
    try {
      await api.compute(uid);
      await load();
      setFlash(t("recomputed"));
      setTimeout(() => setFlash(""), 2500);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const { lines, snapshot, assumptions, activityLines } = data;
  const byActivity = Object.fromEntries(activityLines.map((a) => [a.id, a]));
  // One row per bill. The market-based Scope 2 figure lives inside the
  // expanded detail so the table does not show every electricity bill twice.
  const marketByActivity = Object.fromEntries(lines.filter((l) => l.basis === "market").map((l) => [l.activity_line_id, l]));
  const shown = lines
    .filter((l) => l.basis !== "market")
    .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.energy_type.localeCompare(b.energy_type));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("lede")}</p>
      </div>

      {!snapshot ? (
        <div className="card flex items-center gap-3 p-6">
          <span className="text-sm text-[var(--muted)]">{t("notComputed")}</span>
          <button className="btn" onClick={compute} disabled={busy}>{t("compute")}</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Headline label={t("scope1")} kg={snapshot.totals.scope1_kg} />
            <Headline label={t("scope2loc")} kg={snapshot.totals.scope2_location_kg} />
            <Headline label={t("scope2mkt")} kg={snapshot.totals.scope2_market_kg} />
            <Headline label={t("total")} kg={snapshot.totals.scope1_kg + snapshot.totals.scope2_location_kg} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">{t("tierMix")}:</span>
            {Object.entries(snapshot.totals.tier_mix).map(([k, v]) => (
              <span key={k} className={`pill ${k === "primary" ? "pill-ok" : k === "estimated" ? "pill-warn" : "pill-muted"}`}>{t(`tier.${k}`)} {(v * 100).toFixed(1)}%</span>
            ))}
            <button className="ml-auto text-xs text-[var(--muted)] underline-offset-4 hover:underline" onClick={compute} disabled={busy}>{t("compute")}</button>
            {flash && <span className="text-xs text-[var(--accent)]">{flash}</span>}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">{t("columns.period")}</th>
                  <th className="px-3 py-2">{t("columns.type")}</th>
                  <th className="px-3 py-2 text-right">{t("columns.quantity")}</th>
                  <th className="px-3 py-2 text-right">{t("columns.emissions")}</th>
                  <th className="px-3 py-2 text-right">{t("columns.tier")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <Row key={l.id} uid={uid} line={l} market={marketByActivity[l.activity_line_id]} activity={byActivity[l.activity_line_id]} doc={docs[l.source_doc_id]} assumptions={assumptions} onChanged={load} />
                ))}
              </tbody>
            </table>
          </div>

          {snapshot.skipped.length > 0 && (
            <div className="card p-4 text-sm">
              <div className="font-medium">{t("skipped")}</div>
              <ul className="mt-1 list-disc pl-5 text-[var(--muted)]">{snapshot.skipped.map(([id, why]) => <li key={id}>{why}</li>)}</ul>
            </div>
          )}

          <Link href="/questionnaire" className="btn">{t("next")}</Link>
        </>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Shell>
      <RequireAuth>{(profile, uid) => <Inventory profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
