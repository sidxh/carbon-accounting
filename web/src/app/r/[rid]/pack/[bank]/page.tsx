"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, ExternalLink, FileSpreadsheet, FileText, Paperclip } from "lucide-react";
import { cn as clsx } from "@/lib/cn";
import { useRequest } from "@/components/request-context";
import { EmptyState, PageTitle, SkeletonList } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Pack, type PackCell, type PackItem } from "@/lib/api";

type Loaded = { pack: Pack; counts: Record<string, number>; downloads: { xlsx: string; pdf: string } };

function shown(c: PackCell, t: (k: string) => string): string {
  if (c.portal) return t("portalAnswer");
  if (c.value === null) return c.reason ? `${t("notProvided")}: ${c.reason}` : t("notProvided");
  return typeof c.value === "number" ? c.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : c.value;
}

function Cell({ c, copyLabel, onCopy }: { c: PackCell; copyLabel: string; onCopy: (text: string) => void }) {
  const t = useTranslations("pack");
  const copyable = !c.portal && c.value !== null;
  const text = copyable ? String(c.value) : "";
  return (
    <div className={clsx("rounded-lg px-3 py-2", c.portal ? "bg-sunken" : c.flagged ? "bg-attention-bg/60" : "bg-signal-bg/50")}>
      {c.label && <div className="text-xs text-muted">{c.label}</div>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 whitespace-pre-wrap leading-relaxed">
          {typeof c.value === "number" ? (
            <span className="font-display text-xl tabular">{c.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          ) : (
            <span className={clsx(c.value === null && "italic text-muted")}>{shown(c, t)}</span>
          )}
          {c.unit && c.value !== null && <span className="ml-1.5 text-sm text-muted">{c.unit}</span>}
        </div>
        {copyable && (
          <button className="inline-flex min-h-8 shrink-0 items-center gap-1 text-xs text-signal-ink underline-offset-4 hover:underline" onClick={() => onCopy(text)} aria-label={`${copyLabel}: ${c.label ?? ""}`}>
            <Copy className="size-3" aria-hidden />{copyLabel}
          </button>
        )}
      </div>
      {c.options.length > 0 && c.value === null && (
        <p className="mt-1 text-xs text-muted">{t("options")}: {c.options.join(" · ")}</p>
      )}
      {(c.source || (c.flagged && c.value !== null && c.reason)) && !c.portal && (
        <p className="mt-1 text-xs text-muted">
          {t("how")}: {c.source}
          {c.flagged && c.value !== null && c.reason ? `. ${t("confirm")}: ${c.reason}` : ""}
        </p>
      )}
    </div>
  );
}

function Item({ item, onCopy }: { item: PackItem; onCopy: (text: string) => void }) {
  const t = useTranslations("pack");
  return (
    <li className="p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium"><span className="mr-2 font-mono text-xs text-muted">{item.ref}{item.ref_id ? ` · ${item.ref_id}` : ""}</span>{item.text}</div>
        <span className={clsx("pill shrink-0", item.status === "answered" ? "pill-primary" : item.status === "needs_you" ? "pill-attention" : "pill-muted")}>{t(`status.${item.status}`)}</span>
      </div>
      <div className="mt-2 space-y-2">
        {item.cells.map((c, i) => <Cell key={i} c={c} copyLabel={t("copy")} onCopy={onCopy} />)}
      </div>
      {item.note && <p className="mt-2 text-xs text-muted">{item.note}</p>}
      {item.evidence.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {item.evidence.map((e) => <li key={e} className="flex items-start gap-1.5"><Paperclip className="mt-0.5 size-3 shrink-0" aria-hidden /><span>{e}</span></li>)}
        </ul>
      )}
    </li>
  );
}

export default function PackPage() {
  const { bank, rid } = useParams<{ bank: string; rid: string }>();
  const { uid } = useRequest();
  const t = useTranslations("pack");
  const toast = useToast();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getPack(uid, rid, bank).then(setData).catch((e) => {
      setData(null);
      setError(e instanceof ApiError && e.status === 409 ? t("needInventory") : (e as Error).message);
    });
  }, [uid, rid, bank, t]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("copied"));
    } catch {
      toast(t("copyFailed"), "attention");
    }
  }

  if (data === undefined) return <SkeletonList rows={4} />;
  if (data === null) return (
    <div className="space-y-4">
      <Link href={`/r/${rid}/questionnaire`} className="inline-flex min-h-8 items-center gap-1 text-sm text-signal-ink underline-offset-4 hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("back")}</Link>
      <EmptyState icon={FileSpreadsheet} title={t("unavailable")} body={error} />
    </div>
  );

  const { pack, counts, downloads } = data;
  return (
    <div className="space-y-6">
      <Link href={`/r/${rid}/questionnaire`} className="inline-flex min-h-8 items-center gap-1 text-sm text-signal-ink underline-offset-4 hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("back")}</Link>
      <PageTitle eyebrow={pack.publisher} title={pack.name} lede={t("lede")} />

      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="space-y-1 text-sm">
          <div className="font-medium">{pack.company} · {pack.period}</div>
          <div className="text-xs text-muted">{pack.version}</div>
          <ul className="flex flex-wrap gap-2 pt-1 text-xs">
            <li className="pill pill-primary tabular">{t("status.answered")} · {counts.answered}</li>
            <li className="pill pill-attention tabular">{t("status.needs_you")} · {counts.needs_you}</li>
            <li className="pill pill-muted tabular">{t("status.portal")} · {counts.portal}</li>
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => api.download(downloads.xlsx, `${pack.bank_id}-answer-pack.xlsx`).catch((e) => toast((e as Error).message, "danger"))}><FileSpreadsheet className="size-4" aria-hidden />{t("xlsx")}</button>
          <button className="btn btn-secondary" onClick={() => api.download(downloads.pdf, `${pack.bank_id}-answer-pack.pdf`).catch((e) => toast((e as Error).message, "danger"))}><FileText className="size-4" aria-hidden />{t("pdf")}</button>
        </div>
      </div>

      <p className="card-sunken p-4 text-sm text-muted">{t(`wording.${pack.wording}`)}</p>

      <ul className="card divide-y divide-line overflow-hidden">
        {pack.items.map((item) => <Item key={item.ref} item={item} onCopy={copy} />)}
      </ul>

      <section className="space-y-1 text-xs text-muted" aria-label={t("sources")}>
        <h2 className="font-semibold uppercase tracking-wider">{t("sources")}</h2>
        {pack.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline-offset-4 hover:underline"><ExternalLink className="size-3" aria-hidden />{s.title}</a>
        ))}
        {pack.notes.map((n) => <p key={n}>{n}</p>)}
      </section>
    </div>
  );
}
