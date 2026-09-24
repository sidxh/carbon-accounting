"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { api, type ReconcileState, type SupplierProfile } from "@/lib/api";

function Chat({ uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("reconcile");
  const [state, setState] = useState<ReconcileState | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [computed, setComputed] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.reconcileState(uid).then(setState).catch(() => {});
  }, [uid]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.history.length]);

  // When the conversation finishes, compute straight away so the inventory
  // page is ready when they get there.
  useEffect(() => {
    if (state?.status === "done" && !computed) {
      api.compute(uid).then(() => setComputed(true)).catch(() => {});
    }
  }, [state?.status, computed, uid]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      setState(await api.reconcileStart(uid));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setText("");
    setBusy(true);
    // Optimistic echo so the reply latency reads as thinking, not a dead input.
    setState((s) => s && { ...s, history: [...s.history, { role: "user", text: msg, at: new Date().toISOString() }] });
    try {
      setState(await api.reconcileReply(uid, msg));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const open = state?.issues.filter((i) => !i.resolved && i.kind !== "duplicate").length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("lede")}</p>
      </div>

      {!state || state.status === "idle" ? (
        <button className="btn" onClick={start} disabled={busy}>{busy ? t("checking") : t("start")}</button>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className={`pill ${state.status === "done" ? "pill-ok" : "pill-warn"}`}>
              {state.status === "done" ? t("done") : t("issues", { count: open })}
            </span>
            {computed && <span className="text-[var(--accent)]">{t("computed")}</span>}
            <button className="ml-auto text-xs text-[var(--muted)] underline-offset-4 hover:underline" onClick={start} disabled={busy}>{t("start")}</button>
          </div>

          <div className="card max-h-[55vh] space-y-3 overflow-y-auto p-4">
            {state.history.map((h, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${h.role === "agent" ? "bg-[#f0f0ec]" : "ml-auto bg-[var(--accent)] text-white"}`}>
                {h.text}
              </div>
            ))}
            {busy && <div className="max-w-[85%] rounded-2xl bg-[#f0f0ec] px-4 py-2.5 text-sm text-[var(--muted)]">…</div>}
            <div ref={bottom} />
          </div>

          {state.status === "asking" && (
            <form onSubmit={send} className="flex gap-2">
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("placeholder")} autoFocus disabled={busy} />
              <button className="btn shrink-0" disabled={busy || !text.trim()}>{t("send")}</button>
            </form>
          )}
        </>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {state?.status === "done" && (
        <Link href="/inventory" className="btn">{t("next")}</Link>
      )}
    </div>
  );
}

export default function ReconcilePage() {
  return (
    <Shell>
      <RequireAuth>{(profile, uid) => <Chat profile={profile} uid={uid} />}</RequireAuth>
    </Shell>
  );
}
