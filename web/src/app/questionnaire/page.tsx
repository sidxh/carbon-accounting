"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { api, ApiError, type Answer, type QuestionnaireRecord, type SupplierProfile } from "@/lib/api";

function AnswerRow({ uid, qid, a, onSaved }: { uid: string; qid: string; a: Answer; onSaved: (r: QuestionnaireRecord) => void }) {
  const t = useTranslations("questionnaire");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(typeof a.value === "string" ? a.value : a.value === null ? "" : String(a.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missingRevenue = a.flagged && a.field === "intensity_per_revenue";

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.editAnswer(uid, qid, a.question_id, text.trim());
      onSaved(r.questionnaire);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`p-4 text-sm ${a.flagged ? "bg-[var(--warn-bg)]" : a.edited ? "bg-[#f3f8fd]" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium"><span className="mr-2 font-mono text-xs text-[var(--muted)]">{a.ref}</span>{a.question}</div>
        {a.flagged ? <span className="pill pill-warn shrink-0">{t("flagged")}</span> : a.edited ? <span className="pill pill-muted shrink-0">{t("answeredByYou")}</span> : null}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            className="input min-h-[88px] w-full resize-y"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("editPlaceholder")}
            autoFocus
            disabled={busy}
          />
          <div className="flex gap-2">
            <button className="btn px-4 py-1.5 text-sm" onClick={save} disabled={busy || !text.trim()}>{t("save")}</button>
            <button className="btn btn-secondary px-4 py-1.5 text-sm" onClick={() => { setEditing(false); setError(""); }} disabled={busy}>{t("cancel")}</button>
          </div>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </div>
      ) : (
        <>
          <div className="mt-1.5 whitespace-pre-wrap text-[var(--ink)]">
            {a.value === null ? <i className="text-[var(--muted)]">{a.flag_reason}</i> : typeof a.value === "number" ? a.value.toLocaleString() : a.value}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span>{t("source")}: {a.source}</span>
            {a.editable ? (
              <button className="text-[var(--accent)] underline-offset-4 hover:underline" onClick={() => setEditing(true)}>{t("edit")}</button>
            ) : (
              <Link href="/inventory" className="underline-offset-4 hover:underline">{t("lockedHint")}</Link>
            )}
            {missingRevenue && <Link href="/setup" className="text-[var(--accent)] underline-offset-4 hover:underline">{t("addRevenue")}</Link>}
          </div>
        </>
      )}
    </div>
  );
}

function Questionnaire({ uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("questionnaire");
  const [records, setRecords] = useState<QuestionnaireRecord[]>([]);
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listQuestionnaires(uid).then((r) => setRecords(r.questionnaires.sort((a, b) => b.created_at.localeCompare(a.created_at)))).catch(() => {});
  }, [uid]);

  async function onFile(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      const pct = share.trim() ? Number(share) / 100 : undefined;
      const r = await api.fillQuestionnaire(uid, f, pct);
      setRecords((rs) => [r.questionnaire, ...rs]);
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

  const latest = records[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("lede")}</p>
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <label className="label">{t("share")}</label>
          <input className="input max-w-xs" inputMode="decimal" placeholder={t("sharePlaceholder")} value={share} onChange={(e) => setShare(e.target.value)} />
        </div>
        <input ref={pick} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => pick.current?.click()} disabled={busy}>{busy ? t("filling") : t("fill")}</button>
          <button className="btn btn-secondary" onClick={methodology} disabled={gen}>{gen ? t("generating") : t("methodology")}</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>

      {latest && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">{t("answered", { n: latest.answers.filter((a) => !a.flagged).length, flagged: latest.answers.filter((a) => a.flagged).length })}</span>
            <button className="btn px-4 py-2 text-sm" onClick={() => api.download(`/suppliers/${uid}/questionnaire/${latest.id}/file`, "questionnaire-filled.xlsx")}>{t("download")}</button>
          </div>

          <div className="card divide-y divide-[var(--line)]">
            {latest.answers.map((a) => (
              <AnswerRow
                key={a.question_id}
                uid={uid}
                qid={latest.id}
                a={a}
                onSaved={(r) => setRecords((rs) => rs.map((x) => (x.id === r.id ? r : x)))}
              />
            ))}
          </div>
        </div>
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
