"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ChevronDown, FileText, ImagePlus, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import clsx from "clsx";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { CoverageStrip, EmptyState, PageTitle, SkeletonList } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type DocumentRecord, type SupplierProfile } from "@/lib/api";
import { coverage, ENERGY_ORDER, energyLabel, fyMonths, PERIODIC, shortMonth } from "@/lib/coverage";

const ACCEPT = "image/*,application/pdf";

function Thumb({ uid, doc }: { uid: string; doc: DocumentRecord }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!doc.mime_type.startsWith("image/")) return;
    let url: string | null = null;
    api.documentFileUrl(uid, doc.id).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [uid, doc.id, doc.mime_type]);
  if (!doc.mime_type.startsWith("image/")) {
    return <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-sunken text-muted"><FileText className="size-5" aria-hidden /><span className="sr-only">PDF</span></div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="size-14 shrink-0 rounded-lg border hairline object-cover" /> : <div className="skeleton size-14 shrink-0" />;
}

/** A file chosen but not yet uploaded. */
function StagedFile({ file, onRemove, state }: { file: File; onRemove: () => void; state: "queued" | "uploading" | "done" | "failed" }) {
  const t = useTranslations("documents");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <li className="flex items-center gap-3 py-2">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-10 shrink-0 rounded-md border hairline object-cover" />
      ) : (
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-muted"><FileText className="size-4" aria-hidden /></div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · {state === "uploading" ? t("status.extracting") : state === "done" ? t("status.extracted") : state === "failed" ? t("status.failed") : t("queued")}</div>
      </div>
      {state === "uploading" && <span className="size-4 animate-spin rounded-full border-2 border-signal border-t-transparent" aria-hidden />}
      {state === "queued" && (
        <button className="btn btn-ghost btn-icon" onClick={onRemove} aria-label={t("removeFromList", { name: file.name })}>
          <X className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function DocCard({ uid, doc, onRemove, onRetry, busy }: { uid: string; doc: DocumentRecord; onRemove: () => void; onRetry: () => void; busy: boolean }) {
  const t = useTranslations("documents");
  const lines = doc.extraction?.lines ?? [];
  const empty = doc.status === "extracted" && lines.length === 0;
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="card flex items-start gap-3 p-3">
      <Thumb uid={uid} doc={doc} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-medium">{doc.filename}</span>
          <span className={clsx("pill shrink-0", doc.status === "extracted" && !empty ? "pill-primary" : doc.status === "failed" ? "pill-danger" : empty ? "pill-attention" : "pill-muted")}>
            {empty ? t("status.empty") : t(`status.${doc.status}`)}
          </span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="mt-1 text-sm">
            <span className="font-medium">{energyLabel(l.energy_type)}</span> ·{" "}
            <span className="tabular">{t("read", { quantity: l.quantity.toLocaleString(), unit: l.unit, start: l.period_start, end: l.period_end })}</span>
            <span className={clsx("ml-2 text-xs", l.confidence < 0.7 ? "text-attention" : "text-muted")}>{t("confidence", { pct: Math.round(l.confidence * 100) })}</span>
          </div>
        ))}
        {empty && <p className="mt-1 text-xs text-attention">{t("emptyHint")}</p>}
        {doc.error && <p className="mt-1 break-words text-xs text-danger">{doc.error}</p>}
        {doc.extraction?.warnings?.map((w, i) => <p key={i} className="mt-1 text-xs text-attention">{w}</p>)}
        <div className="mt-2 flex gap-1">
          {(doc.status === "failed" || empty) && (
            <button className="btn btn-ghost btn-sm !min-h-8 gap-1.5 px-2 text-xs" onClick={onRetry} disabled={busy}>
              <RotateCcw className="size-3.5" aria-hidden /> {t("retry")}
            </button>
          )}
          <button className="btn btn-ghost btn-sm !min-h-8 gap-1.5 px-2 text-xs text-danger" onClick={onRemove} disabled={busy}>
            <Trash2 className="size-3.5" aria-hidden /> {t("remove")}
          </button>
        </div>
      </div>
    </motion.li>
  );
}

function Documents({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("documents");
  const locale = useLocale();
  const toast = useToast();
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, "queued" | "uploading" | "done" | "failed">>({});
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<DocumentRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const siteId = profile?.sites[0]?.id;

  const refresh = useCallback(() => api.listDocuments(uid).then((r) => setDocs(r.documents.sort((a, b) => b.created_at.localeCompare(a.created_at)))), [uid]);
  useEffect(() => { refresh(); }, [refresh]);

  function stage(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (files.length !== Array.from(list).length) toast(t("onlyImagesPdf"), "attention");
    setStaged((s) => {
      const seen = new Set(s.map((f) => f.name + f.size));
      return [...s, ...files.filter((f) => !seen.has(f.name + f.size))];
    });
    if (pick.current) pick.current.value = "";
    if (cam.current) cam.current.value = "";
  }

  async function uploadAll() {
    if (!staged.length) return;
    setUploading(true);
    const keys = staged.map((f) => f.name + f.size);
    setProgress(Object.fromEntries(keys.map((k) => [k, "queued" as const])));
    let ok = 0;
    for (const f of staged) {
      const k = f.name + f.size;
      setProgress((p) => ({ ...p, [k]: "uploading" }));
      try {
        // One request per file so a single bad photo does not fail the batch,
        // and the list fills in as each is read.
        await api.uploadDocuments(uid, [f], siteId);
        ok += 1;
        setProgress((p) => ({ ...p, [k]: "done" }));
        await refresh();
      } catch {
        setProgress((p) => ({ ...p, [k]: "failed" }));
      }
    }
    setUploading(false);
    setStaged([]);
    setProgress({});
    toast(t("uploadedToast", { n: ok }), ok === staged.length ? "ok" : "attention");
  }

  async function remove(doc: DocumentRecord) {
    setBusyId(doc.id);
    try {
      await api.deleteDocument(uid, doc.id);
      setDocs((d) => d?.filter((x) => x.id !== doc.id) ?? null);
      toast(t("removedToast", { name: doc.filename }));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusyId(null);
      setConfirmRemove(null);
    }
  }

  async function retry(doc: DocumentRecord) {
    setBusyId(doc.id);
    setDocs((d) => d?.map((x) => (x.id === doc.id ? { ...x, status: "extracting" } : x)) ?? null);
    try {
      const r = await api.retryDocument(uid, doc.id);
      setDocs((d) => d?.map((x) => (x.id === doc.id ? r.document : x)) ?? null);
    } catch (e) {
      toast((e as Error).message, "danger");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  // --- derived: per-energy summary and coverage ------------------------------
  const months = useMemo(() => (profile ? fyMonths(profile.fiscal_year_start, profile.fiscal_year_end) : []), [profile]);
  const groups = useMemo(() => {
    const g: Record<string, { docs: DocumentRecord[]; lines: { period_start: string; period_end: string; quantity: number; unit: string }[] }> = {};
    for (const d of docs ?? []) {
      const ls = d.extraction?.lines ?? [];
      const key = ls[0]?.energy_type ?? (d.status === "failed" ? "_failed" : "_other");
      g[key] ??= { docs: [], lines: [] };
      g[key].docs.push(d);
      g[key].lines.push(...ls);
    }
    const order = (k: string) => (k.startsWith("_") ? 99 : ENERGY_ORDER.indexOf(k) === -1 ? 50 : ENERGY_ORDER.indexOf(k));
    return Object.entries(g).sort(([a], [b]) => order(a) - order(b));
  }, [docs]);

  const extracted = docs?.filter((d) => d.status === "extracted" && (d.extraction?.lines.length ?? 0) > 0).length ?? 0;

  if (docs === null) return <SkeletonList rows={4} />;

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} lede={t("lede")} />

      {/* Drop zone --------------------------------------------------------------- */}
      <div
        className={clsx("card relative flex flex-col items-center gap-3 border-dashed px-5 py-8 text-center transition-colors", dragging ? "border-signal bg-signal-bg" : "border-line-strong")}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); stage(e.dataTransfer.files); }}
      >
        <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => stage(e.target.files)} />
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => stage(e.target.files)} />
        <div className="grid size-12 place-items-center rounded-full bg-sunken text-muted"><UploadCloud className="size-5" aria-hidden /></div>
        <div>
          <div className="font-medium">{t("dropTitle")}</div>
          <div className="text-sm text-muted">{t("dropBody")}</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn" onClick={() => pick.current?.click()} disabled={uploading}><ImagePlus className="size-4" aria-hidden />{t("pick")}</button>
          <button className="btn btn-secondary sm:hidden" onClick={() => cam.current?.click()} disabled={uploading}><Camera className="size-4" aria-hidden />{t("camera")}</button>
        </div>
      </div>

      {/* Staging list ------------------------------------------------------------- */}
      <AnimatePresence>
        {staged.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{t("readyToUpload", { n: staged.length })}</div>
              {!uploading && <button className="btn btn-ghost btn-sm" onClick={() => setStaged([])}>{t("clearAll")}</button>}
            </div>
            <ul className="mt-2 divide-y divide-line">
              {staged.map((f) => (
                <StagedFile key={f.name + f.size} file={f} state={progress[f.name + f.size] ?? "queued"} onRemove={() => setStaged((s) => s.filter((x) => x !== f))} />
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-3">
              <button className="btn" onClick={uploadAll} disabled={uploading}>
                {uploading ? t("uploading", { count: Object.values(progress).filter((p) => p === "queued" || p === "uploading").length }) : t("uploadN", { n: staged.length })}
              </button>
              {uploading && <span className="text-sm text-muted">{t("uploadingHint")}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary + coverage ------------------------------------------------------- */}
      {docs.length > 0 && (
        <section className="card p-4 sm:p-5" aria-labelledby="summary-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="summary-h" className="font-display text-xl">{t("summaryTitle", { n: docs.length })}</h2>
            <span className="text-xs text-muted">{profile ? `${profile.fiscal_year_start} → ${profile.fiscal_year_end}` : ""}</span>
          </div>
          <div className="mt-3 grid gap-3">
            {groups.filter(([k]) => !k.startsWith("_")).map(([key, g]) => {
              const total = g.lines.reduce((s, l) => s + l.quantity, 0);
              const unit = g.lines[0]?.unit ?? "";
              const cov = PERIODIC.has(key) && months.length ? coverage(g.lines, months) : null;
              const missing = cov?.filter((c) => c === "missing").length ?? 0;
              return (
                <div key={key} className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-center">
                  <div>
                    <div className="text-sm font-medium">{energyLabel(key)}</div>
                    <div className="text-xs text-muted">{t("docsCount", { n: g.docs.length })} · <span className="tabular">{total.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}</span></div>
                  </div>
                  {cov ? (
                    <div>
                      <CoverageStrip states={cov} months={months.map((m) => shortMonth(m, locale))} />
                      <div className="mt-1 flex justify-between text-[10px] text-faint"><span>{shortMonth(months[0], locale)}</span><span>{shortMonth(months[months.length - 1], locale)}</span></div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">{t("notPeriodic")}</div>
                  )}
                  <div className="text-xs sm:text-right">
                    {cov ? (missing ? <span className="pill pill-attention">{t("monthsMissing", { n: missing })}</span> : <span className="pill pill-primary">{t("fullYear")}</span>) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">{t("summaryFoot")}</p>
        </section>
      )}

      {/* Documents by energy type -------------------------------------------------- */}
      {docs.length === 0 ? (
        <EmptyState icon={ImagePlus} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="space-y-4">
          {groups.map(([key, g]) => {
            const open = !collapsed[key];
            const label = key === "_failed" ? t("status.failed") : key === "_other" ? t("otherGroup") : energyLabel(key);
            return (
              <section key={key} aria-labelledby={`g-${key}`}>
                <button
                  id={`g-${key}`}
                  className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left hover:bg-sunken"
                  aria-expanded={open}
                  onClick={() => setCollapsed((c) => ({ ...c, [key]: open }))}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">{label}<span className="pill pill-muted tabular">{g.docs.length}</span></span>
                  <ChevronDown className={clsx("size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                  <ul className="mt-1 space-y-2">
                    <AnimatePresence initial={false}>
                      {g.docs.map((d) => (
                        <DocCard key={d.id} uid={uid} doc={d} busy={busyId === d.id} onRemove={() => setConfirmRemove(d)} onRetry={() => retry(d)} />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Link href="/reconcile" className={clsx("btn", extracted === 0 && "pointer-events-none opacity-60")} aria-disabled={extracted === 0}>{t("next")}</Link>
        {extracted === 0 && <span className="text-sm text-muted">{t("needMore")}</span>}
      </div>

      <Dialog
        open={confirmRemove !== null}
        title={t("removeTitle")}
        description={confirmRemove ? t("removeBody", { name: confirmRemove.filename }) : ""}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        tone="danger"
        busy={busyId !== null}
        onConfirm={() => confirmRemove && remove(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
      />
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
