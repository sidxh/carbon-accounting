"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Download, FileSpreadsheet, FileText, Lock, Pencil, UploadCloud } from "lucide-react";
import clsx from "clsx";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { EmptyState, PageTitle, SkeletonList } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Answer, type QuestionnaireRecord, type SupplierProfile } from "@/lib/api";

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

function AnswerRow({ uid, qid, a, onSaved }: { uid: string; qid: string; a: Answer; onSaved: (r: QuestionnaireRecord) => void }) {
  const t = useTranslations("questionnaire");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(typeof a.value === "string" ? a.value : a.value === null ? "" : String(a.value));
  const [busy, setBusy] = useState(false);
  const missingRevenue = a.flagged && a.field === "intensity_per_revenue";
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
    <li className={clsx("p-4 text-sm", a.flagged ? "bg-attention-bg/60" : a.edited ? "bg-tier2-bg/50" : "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium"><span className="mr-2 font-mono text-xs text-muted">{a.ref}</span>{a.question}</div>
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
              <Link href="/inventory" className="inline-flex min-h-8 items-center gap-1 underline-offset-4 hover:underline"><Lock className="size-3" aria-hidden />{t("lockedHint")}</Link>
            )}
            {missingRevenue && <Link href="/setup" className="inline-flex min-h-8 items-center text-signal-ink underline-offset-4 hover:underline">{t("addRevenue")}</Link>}
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

function Questionnaire({ uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("questionnaire");
  const toast = useToast();
  const [records, setRecords] = useState<QuestionnaireRecord[] | null>(null);
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listQuestionnaires(uid).then((r) => setRecords(r.questionnaires.sort((a, b) => b.created_at.localeCompare(a.created_at)))).catch((e) => { setRecords([]); setError((e as Error).message); });
  }, [uid]);

  async function onFile(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) { toast(t("xlsxOnly"), "attention"); return; }
    setBusy(true);
    setError("");
    try {
      const pct = share.trim() ? Number(share) / 100 : undefined;
      const r = await api.fillQuestionnaire(uid, f, pct);
      setRecords((rs) => [r.questionnaire, ...(rs ?? [])]);
      toast(t("filledToast", { n: r.questionnaire.answers.filter((a) => !a.flagged).length }));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message);
    } finally {
      setBusy(false);
      if (pick.current) pick.current.value = "";
    }
  }

  async function methodology() {
    setGen(true);
    setError("");
    try {
      const r = await api.methodology(uid);
      await api.download(r.download, "methodology-note.pdf");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message);
    } finally {
      setGen(false);
    }
  }

  const latest = records?.[0];
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

  if (records === null) return <SkeletonList rows={3} />;

  const auto = latest?.answers.filter((a) => !a.flagged && !a.edited).length ?? 0;
  const yours = latest?.answers.filter((a) => !a.flagged && a.edited).length ?? 0;
  const open = latest?.answers.filter((a) => a.flagged).length ?? 0;

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} lede={t("lede")} />

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div
          className={clsx("card flex flex-col gap-4 border-dashed p-5 transition-colors", dragging ? "border-signal bg-signal-bg" : "border-line-strong")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files); }}
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-sunken text-muted"><FileSpreadsheet className="size-5" aria-hidden /></span>
            <div>
              <div className="font-medium">{t("dropTitle")}</div>
              <div className="text-sm text-muted">{t("dropBody")}</div>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="share">{t("share")}</label>
            <input id="share" className="input max-w-xs tabular" inputMode="decimal" placeholder={t("sharePlaceholder")} value={share} onChange={(e) => setShare(e.target.value)} />
          </div>
          <input ref={pick} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files)} />
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => pick.current?.click()} disabled={busy}><UploadCloud className="size-4" aria-hidden />{busy ? t("filling") : t("fill")}</button>
            <button className="btn btn-secondary" onClick={methodology} disabled={gen}><FileText className="size-4" aria-hidden />{gen ? t("generating") : t("methodology")}</button>
          </div>
          {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        </div>

        {latest ? (
          <div className="card flex flex-col justify-between gap-4 p-5">
            <ProgressRing auto={auto} yours={yours} open={open} />
            <button className="btn btn-secondary btn-sm w-full" onClick={() => api.download(`/suppliers/${uid}/questionnaire/${latest.id}/file`, "questionnaire-filled.xlsx")}>
              <Download className="size-4" aria-hidden />{t("download")}
            </button>
          </div>
        ) : (
          <div className="card-sunken p-5 text-sm text-muted">{t("legend")}</div>
        )}
      </div>

      {!latest ? (
        <EmptyState icon={FileSpreadsheet} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <AnimatePresence initial={false}>
          {sections.map((s, i) => (
            <motion.section key={s.key} initial={{ opacity: 0, transform: "translateY(6px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 0.2, delay: Math.min(i, 4) * 0.04, ease: [0.23, 1, 0.32, 1] }} aria-labelledby={`sec-${s.key}`}>
              <h2 id={`sec-${s.key}`} className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
                {t("sections.label", { key: s.key })}<span className="pill pill-muted tabular">{s.items.length}</span>
              </h2>
              <ul className="card divide-y divide-line overflow-hidden">
                {s.items.map((a) => (
                  <AnswerRow key={a.question_id} uid={uid} qid={latest.id} a={a} onSaved={(r) => setRecords((rs) => (rs ?? []).map((x) => (x.id === r.id ? r : x)))} />
                ))}
              </ul>
            </motion.section>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

export default function QuestionnairePage() {
  return (
    <Shell>
      <RequireAuth>{(profile, uid) => <Questionnaire profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
