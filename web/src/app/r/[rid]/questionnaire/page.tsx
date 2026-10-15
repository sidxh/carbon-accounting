"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight, ChevronDown, Download, FileSpreadsheet, FileText, Globe, Lock, Pencil, ScanSearch, UploadCloud } from "lucide-react";
import { cn as clsx } from "@/lib/cn";
import { useRequest } from "@/components/request-context";
import { SkeletonList } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { EvidenceViewer, type EvidenceItem } from "@/components/evidence-viewer";
import { api, ApiError, type Answer, type PackSummary, type QuestionnaireRecord, type VsmeResult } from "@/lib/api";
import { hasBillsBehind, itemsForLines, linesForField } from "@/lib/evidence";

/** Three-segment ring: answered from data, answered by you, still open. */
function ProgressRing({ auto, yours, open }: { auto: number; yours: number; open: number }) {
  const t = useTranslations("questionnaire");
  const total = Math.max(auto + yours + open, 1);
  const r = 26, c = 2 * Math.PI * r;
  const segs = [
    { n: auto, color: "var(--signal)", label: t("ring.auto") },
    { n: yours, color: "var(--secondary-tier)", label: t("ring.yours") },
    { n: open, color: "var(--attention-strong)", label: t("ring.open") },
  ];
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 64 64" className="size-20 shrink-0 -rotate-90" role="img" aria-label={segs.map((s) => `${s.label} ${s.n}`).join(", ")}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--sunken)" strokeWidth="8" />
        {segs.map((s, i) => {
          const len = (s.n / total) * c;
          const el = <circle key={i} cx="32" cy="32" r={r} fill="none" stroke={s.color} strokeWidth="8" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
          offset += len;
          return el;
        })}
      </svg>
      <div>
        <div className="font-display text-2xl tabular">{auto + yours}<span className="text-base text-muted"> / {auto + yours + open}</span></div>
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {segs.map((s) => <li key={s.label} className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: s.color }} />{s.label} · {s.n}</li>)}
        </ul>
      </div>
    </div>
  );
}

function AnswerRow({ uid, rid, qid, a, onSaved, onShowBills }: { uid: string; rid: string; qid: string; a: Answer; onSaved: (r: QuestionnaireRecord) => void; onShowBills: (a: Answer) => void }) {
  const t = useTranslations("questionnaire");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(typeof a.value === "string" ? a.value : a.value === null ? "" : String(a.value));
  const [busy, setBusy] = useState(false);
  const id = `ans-${a.question_id}`;

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.editAnswer(uid, qid, a.question_id, text.trim());
      onSaved(r.questionnaire);
      setEditing(false);
      toast(t("savedToast", { ref: a.ref ?? "" }));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={clsx("px-5 py-4 text-sm", a.flagged ? "bg-attention-bg/60" : a.edited ? "bg-tier2-bg/50" : "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium"><span className="mr-2 font-mono text-xs text-signal-ink">{a.ref}</span>{a.question}</div>
        {a.flagged ? <span className="pill pill-attention shrink-0">{t("flagged")}</span> : a.edited ? <span className="pill pill-secondary shrink-0">{t("answeredByYou")}</span> : <span className="pill pill-primary shrink-0">{t("fromData")}</span>}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={id} className="sr-only">{a.question}</label>
          <textarea id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("editPlaceholder")} autoFocus disabled={busy} />
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={save} disabled={busy || !text.trim()}>{t("save")}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={busy}>{t("cancel")}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-1.5 whitespace-pre-wrap leading-relaxed text-ink">
            {a.value === null ? <i className="text-muted">{a.flag_reason}</i> : typeof a.value === "number" ? <span className="font-display text-xl tabular">{a.value.toLocaleString()}</span> : a.value}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{t("source")}: {a.source}</span>
            {a.editable ? (
              <button className="inline-flex min-h-8 items-center gap-1 text-signal-ink underline-offset-4 hover:underline" onClick={() => setEditing(true)}><Pencil className="size-3" aria-hidden />{t("edit")}</button>
            ) : (
              <Link href={`/r/${rid}/inventory`} className="inline-flex min-h-8 items-center gap-1 underline-offset-4 hover:underline"><Lock className="size-3" aria-hidden />{t("lockedHint")}</Link>
            )}
            {!a.flagged && a.value !== null && hasBillsBehind(a.field) && (
              <button className="inline-flex min-h-8 items-center gap-1 text-signal-ink underline-offset-4 hover:underline" onClick={() => onShowBills(a)}><ScanSearch className="size-3" aria-hidden />{t("showBills")}</button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/** Group answers by the numeric prefix of their ref (0.x, 20.x, DQ) so the sheet's sections survive. */
function sectionOf(ref: string | null | undefined, fallback: string): string {
  if (!ref) return fallback;
  const m = ref.match(/^([A-Za-z]+|\d+)/);
  return m ? m[1] : fallback;
}

/** Questionnaires with no spreadsheet to fill: portal packs, and EFRAG's own template for the EU VSME. */
function PortalOptions({ uid, rid, periodId }: { uid: string; rid: string; periodId: string }) {
  const t = useTranslations("questionnaire.portal");
  const toast = useToast();
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [vsme, setVsme] = useState<VsmeResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.packs(uid).then((r) => setPacks(r.packs)).catch(() => setPacks([])); }, [uid]);

  async function buildVsme() {
    setBusy(true);
    try {
      const r = await api.vsme(uid, periodId);
      setVsme(r);
      await api.download(r.download, "VSME-Digital-Template-filled.xlsx");
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="portal-h">
      <div>
        <h2 id="portal-h" className="font-mono text-xs text-signal-ink">↳ {t("title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("lede")}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {packs.map((p) => (
          <li key={p.id} className="flex flex-col justify-between gap-4 rounded-[20px] border border-signal/15 bg-raised p-5 text-sm shadow-[var(--shadow-raised)]">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-signal-bg text-signal-ink"><Globe className="size-5" aria-hidden /></span>
              <div>
                <div className="font-display text-lg font-semibold leading-tight text-ink">{p.name}</div>
                <div className="mt-0.5 text-xs text-muted">{p.publisher} · {t("questions", { n: p.questions })}</div>
              </div>
            </div>
            <Link href={`/r/${rid}/pack/${p.id}`} className="btn btn-secondary btn-sm self-start rounded-full">{t("openPack")}<ArrowRight className="size-4" aria-hidden /></Link>
          </li>
        ))}
        <li className="flex flex-col justify-between gap-4 rounded-[20px] border border-signal/15 bg-raised p-5 text-sm shadow-[var(--shadow-raised)] md:col-span-2">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-signal-bg text-signal-ink"><FileSpreadsheet className="size-5" aria-hidden /></span>
            <div>
              <div className="font-display text-lg font-semibold leading-tight text-ink">{t("vsmeTitle")}</div>
              <p className="mt-0.5 text-xs text-muted">{t("vsmeBody")}</p>
            </div>
          </div>
          <div>
            <button className="btn btn-secondary btn-sm rounded-full" onClick={buildVsme} disabled={busy}><Download className="size-4" aria-hidden />{busy ? t("vsmeBusy") : t("vsmeDownload")}</button>
          </div>
          {vsme && (
            <div className="space-y-2 rounded-[14px] bg-sunken p-3 text-xs" role="status">
              <p className="font-medium">{t("vsmeFilled", { n: vsme.filled.length })}</p>
              <p className="font-medium">{t("vsmeOpen")}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted">
                {vsme.open_items.map((o) => <li key={o.ref}><span className="font-mono">{o.ref}</span> {o.label}. {o.reason}</li>)}
              </ul>
              <p className="text-muted">{t("vsmeExcel")}</p>
            </div>
          )}
        </li>
      </ul>
    </section>
  );
}

function Questionnaire() {
  const { uid, period, request, progress, reload } = useRequest();
  const rid = request.id;
  const t = useTranslations("questionnaire");
  const locale = useLocale();
  const toast = useToast();
  const [evidence, setEvidence] = useState<{ heading: string; items: EvidenceItem[]; index: number } | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [latest, setLatest] = useState<QuestionnaireRecord | null | undefined>(undefined);
  const [share, setShare] = useState(request.customer_share != null ? String(Math.round(request.customer_share * 100)) : "");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  // Which sections are open. Unset means: open if it has something for you to look at (or is the first).
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getQuestionnaire(uid, rid).then((r) => setLatest(r.questionnaire)).catch((e) => { setLatest(null); setError((e as Error).message); });
  }, [uid, rid]);

  /** The bills behind a calculator answer: read the inventory and documents on first use. */
  async function showBills(a: Answer) {
    try {
      const [inv, docs] = await Promise.all([api.inventory(uid, period.id), api.listDocuments(uid, period.id)]);
      const lines = linesForField(a.field, inv.lines) ?? [];
      const items = itemsForLines(
        lines,
        Object.fromEntries(inv.activityLines.map((x) => [x.id, x])),
        Object.fromEntries(docs.documents.map((d) => [d.id, d])),
        locale,
      );
      if (!items.length) { toast(t("noBills")); return; }
      setEvidence({ heading: `${a.ref ? a.ref + " · " : ""}${t("billsBehind")}`, items, index: 0 });
      setEvidenceOpen(true);
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function onFile(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) { toast(t("xlsxOnly"), "attention"); return; }
    setBusy(true);
    setError("");
    try {
      const pct = share.trim() ? Number(share) / 100 : undefined;
      const r = await api.fillQuestionnaire(uid, rid, f, pct);
      setLatest(r.questionnaire);
      toast(t("filledToast", { n: r.questionnaire.answers.filter((a) => !a.flagged).length }));
      await reload();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message);
    } finally {
      setBusy(false);
      if (pick.current) pick.current.value = "";
    }
  }

  async function fillAttached() {
    setBusy(true);
    setError("");
    try {
      const pct = share.trim() ? Number(share) / 100 : undefined;
      const r = await api.fillQuestionnaire(uid, rid, null, pct);
      setLatest(r.questionnaire);
      toast(t("filledToast", { n: r.questionnaire.answers.filter((a) => !a.flagged).length }));
      await reload();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function methodology() {
    setGen(true);
    setError("");
    try {
      const r = await api.methodology(uid, period.id);
      await api.download(r.download, "methodology-note.pdf");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message);
    } finally {
      setGen(false);
    }
  }

  const sections = useMemo(() => {
    if (!latest) return [];
    const out: { key: string; items: Answer[] }[] = [];
    for (const a of latest.answers) {
      const k = sectionOf(a.ref, t("sections.other"));
      let s = out.find((x) => x.key === k);
      if (!s) { s = { key: k, items: [] }; out.push(s); }
      s.items.push(a);
    }
    return out;
  }, [latest, t]);

  if (latest === undefined) return <SkeletonList rows={3} />;

  const auto = latest?.answers.filter((a) => !a.flagged && !a.edited).length ?? 0;
  const yours = latest?.answers.filter((a) => !a.flagged && a.edited).length ?? 0;
  const open = latest?.answers.filter((a) => a.flagged).length ?? 0;

  const isOpen = (key: string, i: number, flagged: number) => openSecs[key] ?? (flagged > 0 || i === 0);
  const allOpen = sections.every((s, i) => isOpen(s.key, i, s.items.filter((x) => x.flagged).length));
  const setAll = (v: boolean) => setOpenSecs(Object.fromEntries(sections.map((s) => [s.key, v])));

  return (
    <div className="space-y-6">
      <header className="max-w-2xl">
        <h1 className="font-display text-[2rem] leading-[1.05] text-balance text-ink sm:text-[2.5rem]">{t("title")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted">{t("lede")}</p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Left: everything you do, held in view. ------------------------------------------ */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <section aria-labelledby="fill-h" className="overflow-hidden rounded-[24px] border border-signal/15 bg-raised shadow-[var(--shadow-raised)]">
            <div
              className={clsx("m-3 flex flex-col items-center gap-3 rounded-[18px] border border-dashed px-4 py-6 text-center transition-colors", dragging ? "border-signal bg-signal-bg" : "border-signal/30")}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files); }}
            >
              <div className="grid size-11 place-items-center rounded-full bg-signal-bg text-signal-ink"><FileSpreadsheet className="size-5" aria-hidden /></div>
              <div>
                <h2 id="fill-h" className="font-medium text-ink">{t("dropTitle")}</h2>
                <p className="mt-0.5 text-sm text-muted">{request.template_filename ? t("attachedTemplate", { name: request.template_filename }) : t("dropBody")}</p>
              </div>
              <input ref={pick} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files)} />
              <div className="flex flex-wrap justify-center gap-2">
                <button className="btn rounded-full" onClick={() => pick.current?.click()} disabled={busy}><UploadCloud className="size-4" aria-hidden />{busy ? t("filling") : t("fill")}</button>
                {request.template_key && !latest && (
                  <button className="btn btn-secondary rounded-full" onClick={() => fillAttached()} disabled={busy}><FileSpreadsheet className="size-4" aria-hidden />{t("fillAttached")}</button>
                )}
              </div>
            </div>
            <div className="space-y-4 px-5 pb-5 pt-1">
              <div>
                <label className="label" htmlFor="share">{t("share")}</label>
                <input id="share" className="input tabular" inputMode="decimal" placeholder={t("sharePlaceholder")} aria-describedby="share-hint" value={share} onChange={(e) => setShare(e.target.value)} />
                <p id="share-hint" className="sr-only">{t("sharePlaceholder")}</p>
              </div>
              <button className="btn btn-secondary w-full rounded-full" onClick={methodology} disabled={gen}><FileText className="size-4" aria-hidden />{gen ? t("generating") : t("methodology")}</button>
              {error && <p role="alert" className="rounded-[14px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
            </div>
          </section>

          {latest ? (
            <section aria-label={t("answersTitle")} className="flex flex-col gap-4 rounded-[24px] border border-signal/15 bg-gradient-to-br from-signal-bg to-raised p-5 shadow-[var(--shadow-raised)]">
              <ProgressRing auto={auto} yours={yours} open={open} />
              <button className="btn w-full rounded-full" onClick={() => api.download(api.questionnaireFilePath(uid, latest.id), "questionnaire-filled.xlsx")}>
                <Download className="size-4" aria-hidden />{t("download")}
              </button>
            </section>
          ) : (
            <p className="rounded-[20px] border border-dashed border-signal/30 bg-signal-bg/50 px-5 py-4 text-sm text-pretty text-ink-soft">{t("legend")}</p>
          )}
        </div>

        {/* Right: the answers, one card per section of the customer's sheet. --------------- */}
        <div className="space-y-3">
          {!latest ? (
            <div className="rounded-[24px] border border-dashed border-signal/30 bg-raised/80 px-6 py-10 text-center">
              <p className="font-display text-xl text-ink">{t("emptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-pretty text-muted">{t("emptyBody")}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-mono text-xs text-signal-ink">↳ {t("answersTitle")}<span className="text-muted"> · {latest.answers.length}</span></h2>
                {sections.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setAll(!allOpen)}>{allOpen ? t("collapseAll") : t("expandAll")}</button>
                )}
              </div>
              {sections.map((s, i) => {
                const flagged = s.items.filter((x) => x.flagged).length;
                const expanded = isOpen(s.key, i, flagged);
                return (
                  <motion.section key={s.key} initial={{ opacity: 0, transform: "translateY(6px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 0.2, delay: Math.min(i, 4) * 0.04, ease: [0.23, 1, 0.32, 1] }} aria-labelledby={`sec-${s.key}`} className="rounded-[20px] border border-signal/15 bg-raised shadow-[var(--shadow-raised)]">
                    <button
                      id={`sec-${s.key}`}
                      className="flex w-full items-center gap-4 rounded-[20px] px-5 py-4 text-left transition-colors hover:bg-signal-bg/40"
                      aria-expanded={expanded}
                      aria-controls={`secl-${s.key}`}
                      onClick={() => setOpenSecs((o) => ({ ...o, [s.key]: !expanded }))}
                    >
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <span className="font-display text-xl font-semibold leading-tight text-ink">{t("sections.label", { key: s.key })}</span>
                        <span className="pill pill-muted tabular">{s.items.length}</span>
                        {flagged > 0 && <span className="pill pill-attention tabular">{t("reviewCount", { n: flagged })}</span>}
                      </span>
                      <ChevronDown className={clsx("size-5 shrink-0 text-muted transition-transform", expanded && "rotate-180")} aria-hidden />
                    </button>
                    {/* Kept in the page when closed (hidden), so every answer stays countable and findable. */}
                    <ul id={`secl-${s.key}`} hidden={!expanded} className="card divide-y divide-line overflow-hidden rounded-[0_0_20px_20px] border-x-0 border-b-0 shadow-none">
                      {s.items.map((a) => (
                        <AnswerRow key={a.question_id} uid={uid} rid={rid} qid={latest.id} a={a} onSaved={(r) => setLatest(r)} onShowBills={showBills} />
                      ))}
                    </ul>
                  </motion.section>
                );
              })}
            </>
          )}

          {progress.inventory && <div className="pt-4"><PortalOptions uid={uid} rid={rid} periodId={period.id} /></div>}
        </div>
      </div>

      {evidence && (
        <EvidenceViewer
          uid={uid}
          pid={period.id}
          items={evidence.items}
          index={evidence.index}
          onIndex={(i) => setEvidence((e) => (e ? { ...e, index: i } : e))}
          open={evidenceOpen}
          onClose={() => setEvidenceOpen(false)}
          heading={evidence.heading}
        />
      )}
    </div>
  );
}

export default function QuestionnairePage() {
  return <Questionnaire />;
}
