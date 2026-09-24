"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { api, type DocumentRecord, type SupplierProfile } from "@/lib/api";

function Thumb({ uid, doc }: { uid: string; doc: DocumentRecord }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!doc.mime_type.startsWith("image/")) return;
    let url: string | null = null;
    api.documentFileUrl(uid, doc.id).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [uid, doc.id, doc.mime_type]);
  if (!doc.mime_type.startsWith("image/")) {
    return <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-[#eeeeea] text-xs font-semibold text-[var(--muted)]">PDF</div>;
  }
  // A blob: URL from an authenticated fetch; next/image cannot optimise it.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="size-14 shrink-0 rounded-lg object-cover" /> : <div className="size-14 shrink-0 rounded-lg bg-[#eeeeea]" />;
}

function Documents({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("documents");
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const siteId = profile?.sites[0]?.id;

  const refresh = useCallback(() => api.listDocuments(uid).then((r) => setDocs(r.documents.sort((a, b) => b.created_at.localeCompare(a.created_at)))), [uid]);
  useEffect(() => { refresh(); }, [refresh]);

  async function onFiles(list: FileList | null) {
    if (!list || !list.length) return;
    const files = Array.from(list);
    setPending(files.length);
    setError("");
    try {
      // One request per file so a single bad photo does not fail the batch,
      // and the list fills in as each is read.
      for (const f of files) {
        await api.uploadDocuments(uid, [f], siteId);
        setPending((n) => n - 1);
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(0);
    }
  }

  const extracted = docs.filter((d) => d.status === "extracted").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("lede")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
        <button className="btn" onClick={() => pick.current?.click()} disabled={pending > 0}>{t("pick")}</button>
        <button className="btn btn-secondary sm:hidden" onClick={() => cam.current?.click()} disabled={pending > 0}>{t("camera")}</button>
        {pending > 0 && <span className="self-center text-sm text-[var(--muted)]">{t("uploading", { count: pending })}</span>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {docs.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--muted)]">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="card flex items-start gap-3 p-3">
              <Thumb uid={uid} doc={d} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{d.filename}</span>
                  <span className={`pill ${d.status === "extracted" ? "pill-ok" : d.status === "failed" ? "pill-warn" : "pill-muted"}`}>{t(`status.${d.status}`)}</span>
                </div>
                {d.extraction?.lines.map((l, i) => (
                  <div key={i} className="mt-1 text-sm">
                    <span className="capitalize">{l.energy_type.replace("_", " ")}</span> ·{" "}
                    {t("read", { quantity: l.quantity.toLocaleString(), unit: l.unit, start: l.period_start, end: l.period_end })}
                    <span className={`ml-2 text-xs ${l.confidence < 0.7 ? "text-[var(--warn)]" : "text-[var(--muted)]"}`}>{t("confidence", { pct: Math.round(l.confidence * 100) })}</span>
                  </div>
                ))}
                {d.error && <p className="mt-1 text-xs text-red-700">{d.error}</p>}
                {d.extraction?.warnings?.map((w, i) => <p key={i} className="mt-1 text-xs text-[var(--warn)]">{w}</p>)}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Link href="/reconcile" className={`btn ${extracted === 0 ? "pointer-events-none opacity-50" : ""}`}>{t("next")}</Link>
        {extracted === 0 && docs.length === 0 && <span className="text-sm text-[var(--muted)]">{t("needMore")}</span>}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Shell>
      <RequireAuth>{(profile, uid) => <Documents profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
