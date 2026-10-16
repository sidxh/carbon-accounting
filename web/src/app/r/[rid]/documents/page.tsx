"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Camera, ChevronDown, Download, FileText, ImagePlus, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import { cn as clsx } from "@/lib/cn";
import { useRequest } from "@/components/request-context";
import { SharedNotice } from "@/components/shared-notice";
import { SkeletonList } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type DocumentRecord } from "@/lib/api";
import { expandBillFiles, filesFromDrop } from "@/lib/bill-files";
import { coverage, ENERGY_ORDER, energyLabel, fyMonths, PERIODIC, shortMonth } from "@/lib/coverage";

const ACCEPT = "image/*,application/pdf,.zip,application/zip";

function Thumb({ uid, pid, doc }: { uid: string; pid: string; doc: DocumentRecord }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!doc.mime_type.startsWith("image/")) return;
    let url: string | null = null;
    api.documentFileUrl(uid, pid, doc.id).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [uid, pid, doc.id, doc.mime_type]);
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

/** One bill inside its energy group: thumbnail, name, what was read, its status, retry and remove. */
function DocCard({ uid, pid, doc, onRemove, onRetry, busy }: { uid: string; pid: string; doc: DocumentRecord; onRemove: () => void; onRetry: () => void; busy: boolean }) {
  const t = useTranslations("documents");
  const lines = doc.extraction?.lines ?? [];
  const empty = doc.status === "extracted" && lines.length === 0;
  return (
    <motion.li
      initial={{ opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "scale(0.98)" }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="card flex items-start gap-3 rounded-[16px] p-3 shadow-none"
    >
      <Thumb uid={uid} pid={pid} doc={doc} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-medium">{doc.filename}</span>
          <span className={clsx("pill shrink-0", doc.status === "extracted" && !empty ? "pill-primary" : doc.status === "failed" ? "pill-danger" : empty ? "pill-attention" : "pill-muted")}>
            {empty ? t("status.empty") : t(`status.${doc.status}`)}
          </span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="mt-0.5 text-xs text-ink-soft">
            <span className="tabular">{t("read", { quantity: l.quantity.toLocaleString(), unit: l.unit, start: l.period_start, end: l.period_end })}</span>
            <span className={clsx("ml-2", l.confidence < 0.7 ? "text-attention" : "text-muted")}>{t("confidence", { pct: Math.round(l.confidence * 100) })}</span>
          </div>
        ))}
        {empty && <p className="mt-1 text-xs text-attention">{t("emptyHint")}</p>}
        {doc.error && <p className="mt-1 break-words text-xs text-danger">{doc.error}</p>}
        {doc.extraction?.warnings?.map((w, i) => <p key={i} className="mt-1 text-xs text-attention">{w}</p>)}
        <div className="mt-1.5 flex gap-1">
          {(doc.status === "failed" || empty) && (
            <button className="btn btn-ghost btn-sm !min-h-7 gap-1.5 px-2 text-xs" onClick={onRetry} disabled={busy}>
              <RotateCcw className="size-3.5" aria-hidden /> {t("retry")}
            </button>
          )}
          <button className="btn btn-ghost btn-sm !min-h-7 gap-1.5 px-2 text-xs text-danger" onClick={onRemove} disabled={busy}>
            <Trash2 className="size-3.5" aria-hidden /> {t("remove")}
          </button>
        </div>
      </div>
    </motion.li>
  );
}

function Documents() {
  const { uid, profile, period, request, view, reload } = useRequest();
  const pid = period.id;
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
  // Which energy groups are open. Groups that need action (failed, unread) start open; the rest start closed.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const siteId = profile.sites[0]?.id;
  // One Continue in view at a time: the header's is the main one; the closing card's
  // button shows only once the header's has scrolled out of view.
  const [headerContinue, setHeaderContinue] = useState<HTMLDivElement | null>(null);
  const [headerContinueVisible, setHeaderContinueVisible] = useState(true);
  useEffect(() => {
    if (!headerContinue) return;
    const io = new IntersectionObserver(([e]) => setHeaderContinueVisible(e.isIntersecting), { threshold: 0 });
    io.observe(headerContinue);
    return () => io.disconnect();
  }, [headerContinue]);

  const refresh = useCallback(() => api.listDocuments(uid, pid).then((r) => setDocs(r.documents.sort((a, b) => b.created_at.localeCompare(a.created_at)))), [uid, pid]);
  useEffect(() => { refresh(); }, [refresh]);

  /** Add what was chosen or dropped to the list: bills as they are, zips opened, anything else skipped. */
  async function stage(list: FileList | File[] | null) {
    if (!list || !Array.from(list).length) return;
    const { files, skipped } = await expandBillFiles(Array.from(list));
    if (skipped) toast(files.length ? t("onlyImagesPdf") : t("noBillsFound"), "attention");
    setStaged((s) => {
      const seen = new Set(s.map((f) => f.name + f.size));
      return [...s, ...files.filter((f) => !seen.has(f.name + f.size))];
    });
    if (pick.current) pick.current.value = "";
    if (cam.current) cam.current.value = "";
  }

  async function onDrop(dt: DataTransfer) {
    await stage(await filesFromDrop(dt));
  }

  /** How many bills are read at once. Each is its own request, so one bad photo never fails the rest. */
  const PARALLEL = 4;

  async function uploadAll() {
    if (!staged.length) return;
    setUploading(true);
    const batch = staged;
    const keys = batch.map((f) => f.name + f.size);
    setProgress(Object.fromEntries(keys.map((k) => [k, "queued" as const])));
    let ok = 0;
    let next = 0;
    async function worker() {
      while (next < batch.length) {
        const f = batch[next++];
        const k = f.name + f.size;
        setProgress((p) => ({ ...p, [k]: "uploading" }));
        try {
          await api.uploadDocuments(uid, pid, [f], siteId);
          ok += 1;
          setProgress((p) => ({ ...p, [k]: "done" }));
          await refresh();
        } catch {
          setProgress((p) => ({ ...p, [k]: "failed" }));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, worker));
    setUploading(false);
    setStaged([]);
    setProgress({});
    toast(t("uploadedToast", { n: ok }), ok === batch.length ? "ok" : "attention");
    await reload();
  }

  async function remove(doc: DocumentRecord) {
    setBusyId(doc.id);
    try {
      await api.deleteDocument(uid, pid, doc.id);
      setDocs((d) => d?.filter((x) => x.id !== doc.id) ?? null);
      toast(t("removedToast", { name: doc.filename }));
      await reload();
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
      const r = await api.retryDocument(uid, pid, doc.id);
      setDocs((d) => d?.map((x) => (x.id === doc.id ? r.document : x)) ?? null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "danger");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  // --- derived: per-energy summary and coverage ------------------------------
  const months = useMemo(() => fyMonths(period.start, period.end), [period]);
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

  const pending = Object.values(progress).filter((p) => p === "queued" || p === "uploading").length;
  // Monthly bills with no bill yet, across the monthly energies (asked about on the next step).
  const missingTotal = groups.reduce((n, [key, g]) => (PERIODIC.has(key) && months.length ? n + coverage(g.lines, months).filter((c) => c === "missing").length : n), 0);
  const continueButton = (
    <Link href={`/r/${request.id}/reconcile`} className={clsx("btn gap-1.5 rounded-full", extracted === 0 && "pointer-events-none opacity-60")} aria-disabled={extracted === 0}>
      {t("next")}<ArrowRight className="size-4" aria-hidden />
    </Link>
  );

  return (
    <div className="space-y-6">
      {/* The page's next step sits with its title, top right, as on Home. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-[1.05] text-balance text-ink sm:text-[2.5rem]">{t("title")}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted">{t("lede")}</p>
        </div>
        <div ref={setHeaderContinue} className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">{continueButton}{extracted === 0 && <span className="text-xs text-muted">{t("needMore")}</span>}</div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Left: everything you do, held in view. ------------------------------------------ */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <section aria-labelledby="add-h" className="overflow-hidden rounded-[24px] border border-signal/15 bg-raised shadow-[var(--shadow-raised)]">
            <div
              className={clsx(
                "m-3 flex rounded-[18px] border border-dashed transition-colors",
                // Once files are chosen it shrinks to one row, so the list and Upload stay in view.
                staged.length ? "items-center justify-between gap-3 px-4 py-3 text-left" : "flex-col items-center gap-3 px-4 py-6 text-center",
                dragging ? "border-signal bg-signal-bg" : "border-signal/30",
              )}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void onDrop(e.dataTransfer); }}
            >
              <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => stage(e.target.files)} />
              <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => stage(e.target.files)} />
              {!staged.length && <div className="grid size-11 place-items-center rounded-full bg-signal-bg text-signal-ink"><UploadCloud className="size-5" aria-hidden /></div>}
              <div>
                <h2 id="add-h" className="font-medium text-ink">{t("dropTitle")}</h2>
                {!staged.length && <p className="mt-0.5 text-sm text-muted">{t("dropBody")}</p>}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button className={clsx("btn rounded-full", staged.length > 0 && "btn-secondary btn-sm")} onClick={() => pick.current?.click()} disabled={uploading}><ImagePlus className="size-4" aria-hidden />{staged.length ? t("addMore") : t("pick")}</button>
                <button className="btn btn-secondary rounded-full sm:hidden" onClick={() => cam.current?.click()} disabled={uploading}><Camera className="size-4" aria-hidden />{t("camera")}</button>
              </div>
              {/* Nothing to try with? A zip of the sample Japanese bills (public/), shown only on the empty drop zone. */}
              {!staged.length && (
                <div className="flex flex-col items-center gap-1.5">
                  <a href="/sample-bills-japan.zip" download className="btn btn-secondary rounded-full"><Download className="size-4" aria-hidden />{t("sampleDownload")}</a>
                  <p className="text-xs text-muted">{t("sampleHint")}</p>
                </div>
              )}
            </div>

            {/* Chosen files: a short scrolling list, with Upload always in reach. */}
            <AnimatePresence initial={false}>
              {staged.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="border-t border-dashed border-signal/25">
                  <div className="flex items-center justify-between gap-3 px-4 pt-3" role="status" aria-live="polite">
                    <span className="text-sm font-medium text-ink">{uploading ? t("uploading", { count: pending }) : t("readyToUpload", { n: staged.length })}</span>
                    {!uploading && <button className="btn btn-ghost btn-sm" onClick={() => setStaged([])}>{t("clearAll")}</button>}
                  </div>
                  <ul className="max-h-[42dvh] divide-y divide-line overflow-auto px-4">
                    {staged.map((f) => (
                      <StagedFile key={f.name + f.size} file={f} state={progress[f.name + f.size] ?? "queued"} onRemove={() => setStaged((s) => s.filter((x) => x !== f))} />
                    ))}
                  </ul>
                  <div className="border-t border-line bg-raised px-4 py-3">
                    <button className="btn w-full rounded-full" onClick={uploadAll} disabled={uploading}>
                      {uploading ? t("uploading", { count: pending }) : t("uploadN", { n: staged.length })}
                    </button>
                    {uploading && <p className="mt-2 text-center text-xs text-muted">{t("uploadingHint")}</p>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

        </div>

        {/* Right: what was read, one dropdown per energy type. ------------------------------- */}
        <section aria-labelledby="read-h" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="read-h" className="font-mono text-xs text-signal-ink">↳ {t("readTitle")}{docs.length > 0 && <span className="text-muted"> · {t("docsCount", { n: docs.length })}</span>}</h2>
            <span className="text-xs text-muted">{period.label} · {period.start} → {period.end}</span>
          </div>
          <SharedNotice sharedWith={view.shared_with} periodLabel={period.label} />

          {docs.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-signal/30 bg-raised/80 px-6 py-10 text-center">
              <p className="font-display text-xl text-ink">{t("empty")}</p>
              <p className="mt-1 text-sm text-muted">{t("emptyBody")}</p>
            </div>
          ) : (
            <>
              {groups.map(([key, g]) => {
                const needsAction = key.startsWith("_");
                const open = openGroups[key] ?? needsAction;
                const label = key === "_failed" ? t("status.failed") : key === "_other" ? t("otherGroup") : energyLabel(key);
                const total = g.lines.reduce((sum, l) => sum + l.quantity, 0);
                const unit = g.lines[0]?.unit ?? "";
                const cov = !needsAction && PERIODIC.has(key) && months.length ? coverage(g.lines, months) : null;
                const missing = cov?.filter((c) => c === "missing").length ?? 0;
                // The months with no bill, in plain words ("Feb, Mar, Apr"), instead of a strip of empty boxes.
                const missingNames = cov ? months.filter((_, i) => cov[i] === "missing").map((m) => shortMonth(m, locale)).join(", ") : "";
                const reading = g.docs.some((d) => d.status === "extracting" || d.status === "uploaded");
                return (
                  <section key={key} aria-labelledby={`g-${key}`} className="rounded-[20px] border border-signal/15 bg-raised shadow-[var(--shadow-raised)]">
                    <button
                      id={`g-${key}`}
                      className="flex w-full items-center gap-4 rounded-[20px] px-5 py-4 text-left transition-colors hover:bg-signal-bg/40"
                      aria-expanded={open}
                      aria-controls={`gl-${key}`}
                      onClick={() => setOpenGroups((o) => ({ ...o, [key]: !open }))}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-xl font-semibold leading-tight text-ink">{label}</span>
                          {cov && (missing ? <span className="pill pill-attention">{t("monthsMissing", { n: missing })}</span> : <span className="pill pill-primary">{t("fullYear")}</span>)}
                          {needsAction && <span className="pill pill-danger">{t("needsLook")}</span>}
                          {reading && <span className="pill pill-muted">{t("reading")}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {t("docsCount", { n: g.docs.length })}
                          {!needsAction && total > 0 && <> · <span className="tabular">{total.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}</span></>}
                        </span>
                        {missing > 0 && <span className="mt-1 block text-sm text-attention">{t("missingFor", { months: missingNames })}</span>}
                      </span>
                      <ChevronDown className={clsx("size-5 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
                    </button>
                    {/* Kept in the page when closed (hidden), so every bill stays countable and findable. */}
                    <ul id={`gl-${key}`} hidden={!open} className="space-y-2 px-3 pb-3">
                      <AnimatePresence initial={false}>
                        {g.docs.map((d) => (
                          <DocCard key={d.id} uid={uid} pid={pid} doc={d} busy={busyId === d.id} onRemove={() => setConfirmRemove(d)} onRetry={() => retry(d)} />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </section>
                );
              })}
              {/* Where the eye ends after checking: what is still missing, and (when the header's Continue has scrolled away) the way on. */}
              {extracted > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-dashed border-signal/30 bg-signal-bg/50 px-5 py-4">
                  <p className="min-w-[12rem] flex-1 text-sm text-ink-soft">{missingTotal ? t("stillMissing", { n: missingTotal }) : t("allCovered")}</p>
                  <AnimatePresence initial={false}>
                    {!headerContinueVisible && (
                      <motion.span key="continue" className="inline-flex shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>{continueButton}</motion.span>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog
        open={confirmRemove !== null}
        title={t("removeTitle")}
        description={confirmRemove ? t("removeBody", { name: confirmRemove.filename }) + (view.shared_with.length ? " " + t("removeShared", { n: view.shared_with.length, names: view.shared_with.join(", ") }) : "") : ""}
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
  return <Documents />;
}
