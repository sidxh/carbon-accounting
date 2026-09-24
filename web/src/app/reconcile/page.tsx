"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, CircleDashed, MessageSquareText, RotateCcw, ScanSearch, Send } from "lucide-react";
import { cn as clsx } from "@/lib/cn";
import { RequireAuth } from "@/components/require-auth";
import { Shell } from "@/components/shell";
import { CoverageStrip, PageTitle, SkeletonList } from "@/components/ui/bits";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, type Issue, type ReconcileState, type SupplierProfile } from "@/lib/api";
import { energyLabel, shortMonth } from "@/lib/coverage";

const ASKABLE = new Set(["gap", "unit_hours", "low_confidence"]);

function issueLabel(i: Issue, t: ReturnType<typeof useTranslations>, locale: string): string {
  const et = i.energy_type ? energyLabel(i.energy_type) : "";
  if (i.kind === "gap") {
    const ms = i.months.map((m) => shortMonth(m, locale));
    const range = ms.length > 2 ? `${ms[0]} – ${ms[ms.length - 1]}` : ms.join(", ");
    return t("issue.gap", { energy: et, months: range, n: i.months.length });
  }
  if (i.kind === "unit_hours") return t("issue.unitHours", { energy: et });
  if (i.kind === "low_confidence") return t("issue.lowConfidence", { energy: et });
  return i.detail;
}

function Found({ state, fy }: { state: ReconcileState; fy: [string, string] }) {
  const t = useTranslations("reconcile");
  const locale = useLocale();
  const s = state.summary;
  const notes: string[] = [];
  if (s.duplicates_dropped) notes.push(t("note.duplicates", { n: s.duplicates_dropped }));
  if (s.apportioned) notes.push(t("note.apportioned", { n: s.apportioned }));
  if (s.converted) notes.push(t("note.converted", { n: s.converted }));
  if (s.outside_fy) notes.push(t("note.outsideFy", { n: s.outside_fy }));
  if (s.estimated_lines) notes.push(t("note.estimated", { n: s.estimated_lines }));
  const monthLabels = s.months.map((m) => shortMonth(m, locale));

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="found-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="found-h" className="font-display text-xl text-balance">{t("found.title", { docs: s.documents, lines: s.lines })}</h2>
        <span className="text-xs text-muted">{fy[0]} → {fy[1]}</span>
      </div>
      {s.energy.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("found.none")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {s.energy.map((e) => (
            <li key={e.energy_type} className="grid gap-2 sm:grid-cols-[170px_1fr_auto] sm:items-center">
              <div>
                <div className="text-sm font-medium">{energyLabel(e.energy_type)}</div>
                <div className="text-xs text-muted tabular">{t("found.lines", { docs: e.documents, lines: e.lines })} · {e.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} {e.unit}</div>
              </div>
              {e.periodic ? (
                <div>
                  <CoverageStrip states={e.coverage} months={monthLabels} />
                  <div className="mt-1 flex justify-between text-[10px] text-faint"><span>{monthLabels[0]}</span><span>{monthLabels[monthLabels.length - 1]}</span></div>
                </div>
              ) : (
                <div className="text-xs text-muted">{t("found.deliveries")}</div>
              )}
              <div className="sm:text-right">
                {e.periodic && (e.months_missing ? (
                  <span className="pill pill-attention">{t("found.missing", { n: e.months_missing })}</span>
                ) : e.months_estimated ? (
                  <span className="pill pill-estimated">{t("found.estimatedMonths", { n: e.months_estimated })}</span>
                ) : (
                  <span className="pill pill-primary">{t("found.complete")}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t hairline pt-3 text-xs text-muted">
          {notes.map((n) => <li key={n} className="flex items-center gap-1.5"><Check className="size-3 text-signal" aria-hidden />{n}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-signal" />{t("legend.primary")}</span>
        <span className="flex items-center gap-1.5"><span className="coverage inline-grid h-2 w-4 !grid-cols-1"><span className="cov-estimated !h-2" /></span>{t("legend.estimated")}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm border border-dashed border-line-strong" />{t("legend.missing")}</span>
      </div>
    </section>
  );
}

function OpenItems({ state }: { state: ReconcileState }) {
  const t = useTranslations("reconcile");
  const locale = useLocale();
  const items = state.issues.filter((i) => ASKABLE.has(i.kind));
  if (!items.length) return null;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="items-h">
      <h2 id="items-h" className="font-display text-xl text-balance">{t("items.title", { n: items.filter((i) => !i.resolved).length })}</h2>
      <ul className="mt-3 space-y-2">
        {items.map((i) => {
          const pending = state.pending_issue_id === i.id;
          return (
            <li key={i.id} className={clsx("flex items-start gap-3 rounded-lg px-3 py-2 text-sm", pending && "bg-attention-bg")}>
              {i.resolved ? (
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-signal text-signal-on"><Check className="size-3" aria-hidden /></span>
              ) : (
                <CircleDashed className={clsx("mt-0.5 size-5 shrink-0", pending ? "text-attention" : "text-faint")} aria-hidden />
              )}
              <div className="flex-1">
                <div className={clsx(i.resolved && "text-muted line-through decoration-line-strong")}>{issueLabel(i, t, locale)}</div>
                <div className="text-xs text-muted">{i.resolved ? t("items.resolved") : pending ? t("items.asking") : t("items.queued")}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Chat({ profile, uid }: { profile: SupplierProfile | null; uid: string }) {
  const t = useTranslations("reconcile");
  const toast = useToast();
  const [state, setState] = useState<ReconcileState | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [computed, setComputed] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.reconcileState(uid).then(setState).catch((e) => setError((e as Error).message));
  }, [uid]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      setComputed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError("");
    try {
      await api.resetData(uid, "chat");
      setState(await api.reconcileState(uid));
      setComputed(false);
      toast(t("resetDone"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setText("");
    setBusy(true);
    setState((s) => s && { ...s, history: [...s.history, { role: "user", text: msg, at: new Date().toISOString() }] });
    try {
      setState(await api.reconcileReply(uid, msg));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => input.current?.focus(), 0);
    }
  }

  if (!state) return <SkeletonList rows={3} />;

  const fy: [string, string] = [profile?.fiscal_year_start ?? "", profile?.fiscal_year_end ?? ""];
  const open = state.issues.filter((i) => !i.resolved && ASKABLE.has(i.kind)).length;
  const started = state.status !== "idle";
  const askable = state.issues.filter((i) => ASKABLE.has(i.kind)).length;

  return (
    <div className="space-y-5">
      <PageTitle title={t("title")} lede={t("lede")} />

      <Found state={state} fy={fy} />

      {!started ? (
        <div className="card flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted">{state.summary.documents ? t("startHint") : t("startNoDocs")}</div>
          <button className="btn" onClick={start} disabled={busy || !state.summary.documents}>
            <ScanSearch className="size-4" aria-hidden />{busy ? t("checking") : t("start")}
          </button>
        </div>
      ) : (
        <>
          <OpenItems state={state} />

          <section className="card overflow-hidden" aria-labelledby="chat-h">
            <div className="flex items-center justify-between gap-2 border-b hairline px-4 py-3">
              <h2 id="chat-h" className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquareText className="size-4 text-muted" aria-hidden />
                {t("chatTitle")}
              </h2>
              <span className={clsx("pill", state.status === "done" ? "pill-primary" : "pill-attention")}>
                {state.status === "done" ? t("done") : t("issues", { count: open })}
              </span>
            </div>

            <div className="max-h-[52vh] space-y-3 overflow-y-auto p-4" role="log" aria-live="polite">
              <div className="mx-auto max-w-[90%] rounded-xl bg-sunken px-4 py-2.5 text-center text-xs text-muted">
                {t("systemCard", { docs: state.summary.documents, n: askable })}
              </div>
              <AnimatePresence initial={false}>
                {state.history.map((h, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, transform: "translateY(6px)" }}
                    animate={{ opacity: 1, transform: "translateY(0px)" }}
                    transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    className={clsx("max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed", h.role === "agent" ? "bg-sunken text-ink" : "ml-auto bg-signal text-signal-on")}
                  >
                    {h.text}
                  </motion.div>
                ))}
              </AnimatePresence>
              {busy && (
                <div className="flex max-w-[85%] items-center gap-1 rounded-2xl bg-sunken px-4 py-3" aria-label={t("thinking")}>
                  {[0, 1, 2].map((i) => <span key={i} className="dot-pulse size-1.5 rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />)}
                </div>
              )}
              <div ref={bottom} />
            </div>

            {state.status === "asking" && (
              <form onSubmit={send} className="flex gap-2 border-t hairline p-3">
                <input ref={input} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} autoFocus disabled={busy} />
                <button className="btn btn-icon shrink-0 !min-h-11 !min-w-11" disabled={busy || !text.trim()} aria-label={t("send")}>
                  <Send className="size-4" aria-hidden />
                </button>
              </form>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            {state.status === "done" && (
              <Link href="/inventory" className="btn">{t("next")}<ArrowRight className="size-4" aria-hidden /></Link>
            )}
            {computed && <span className="text-sm text-signal-ink">{t("computed")}</span>}
            <span className="flex-1" />
            <button className="btn btn-ghost btn-sm" onClick={start} disabled={busy}><ScanSearch className="size-4" aria-hidden />{t("start")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)} disabled={busy}><RotateCcw className="size-4" aria-hidden />{t("reset")}</button>
          </div>
        </>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Dialog
        open={confirmReset}
        title={t("reset")}
        description={t("resetConfirm")}
        confirmLabel={t("reset")}
        cancelLabel={t("cancel")}
        tone="danger"
        busy={busy}
        onConfirm={reset}
        onClose={() => setConfirmReset(false)}
      />
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
