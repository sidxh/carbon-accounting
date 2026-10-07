"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@base-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, CircleAlert, FileText, X } from "lucide-react";
import { cn as clsx } from "@/lib/cn";
import { api, type LineCheck } from "@/lib/api";

const EASE = [0.23, 1, 0.32, 1] as const;

/** One number's evidence: which bill, which page, where on the page. */
export interface EvidenceItem {
  id: string;
  docId: string;
  filename?: string;
  page: number;
  /** [ymin, xmin, ymax, xmax] on a 0..1000 scale; null for bills read before positions were recorded. */
  box: number[] | null;
  title: string;
  /** What the calculation used, e.g. "42,569 kWh". */
  value: string;
  note?: string;
  checks?: LineCheck[];
}

// One blob per page for the session; re-opening the same bill is instant.
const pages = new Map<string, Promise<string>>();
function pageUrl(uid: string, pid: string, docId: string, page: number) {
  const key = `${pid}/${docId}/${page}`;
  let p = pages.get(key);
  if (!p) {
    p = api.documentPageUrl(uid, pid, docId, page);
    p.catch(() => pages.delete(key));
    pages.set(key, p);
  }
  return p;
}

/** Pass / fail pills for the plausibility checks a line went through. */
export function CheckPills({ checks, className }: { checks?: LineCheck[]; className?: string }) {
  const t = useTranslations("evidence.checks");
  if (!checks?.length) return null;
  return (
    <ul className={clsx("flex flex-wrap gap-1.5", className)}>
      {checks.map((c) => (
        <li
          key={c.id}
          title={c.detail}
          className={clsx("pill", c.status === "fail" ? "pill-attention" : "pill-ok")}
        >
          {c.status === "fail" ? <CircleAlert className="size-3" aria-hidden /> : <Check className="size-3" strokeWidth={3} aria-hidden />}
          {t(`${c.id}.${c.status}`)}
        </li>
      ))}
    </ul>
  );
}

const backdrop =
  "fixed inset-0 z-dialog bg-ink/50 transition-opacity duration-[var(--dur-enter)] ease-[var(--ease-out)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";
const popup =
  "card fixed inset-2 z-dialog flex flex-col overflow-hidden p-0 shadow-[var(--shadow-float)] outline-none sm:inset-6 lg:inset-x-[max(1.5rem,calc(50%-560px))] " +
  "transition-[scale,opacity] duration-[var(--dur-enter)] ease-[var(--ease-out)] " +
  "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0";

/**
 * "Show me where": the source bill with the printed value spotlighted.
 * Several items (the bills behind a questionnaire total) get a list beside
 * the page; one item gets just the page.
 */
export function EvidenceViewer({
  uid,
  pid,
  items,
  index,
  onIndex,
  open,
  onClose,
  heading,
}: {
  uid: string;
  pid: string;
  items: EvidenceItem[];
  index: number;
  onIndex: (i: number) => void;
  open: boolean;
  onClose: () => void;
  heading?: string;
}) {
  const t = useTranslations("evidence");
  const reduce = useReducedMotion();
  const item = items[index];
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);

  const docId = item?.docId, page = item?.page ?? 1;
  useEffect(() => {
    if (!open || !docId) return;
    let live = true;
    setSrc(null); setFailed(false); setLoaded(false);
    pageUrl(uid, pid, docId, page).then((u) => live && setSrc(u)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [open, uid, pid, docId, page]);

  function onLoad() {
    setLoaded(true);
    const box = item?.box, el = scroller.current, im = img.current;
    if (!box || !el || !im) return;
    const mid = ((box[0] + box[2]) / 2 / 1000) * im.clientHeight;
    el.scrollTo({ top: Math.max(0, mid - el.clientHeight / 2), behavior: reduce ? "auto" : "smooth" });
  }

  if (!item) return null;
  const b = item.box;
  const pad = 4; // of 1000, so a tight box still has air around it
  const style = b
    ? { top: `${(b[0] - pad) / 10}%`, left: `${(b[1] - pad) / 10}%`, height: `${(b[2] - b[0] + 2 * pad) / 10}%`, width: `${(b[3] - b[1] + 2 * pad) / 10}%` }
    : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdrop} />
        <Dialog.Popup className={popup}>
          <header className="flex items-start justify-between gap-3 border-b hairline px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-xl text-balance text-ink">{heading ?? t("title")}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">{b ? t("hint") : t("noBox")}</Dialog.Description>
            </div>
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose} aria-label={t("close")}><X className="size-4" aria-hidden /></button>
          </header>

          <div className={clsx("grid min-h-0 flex-1 gap-0", items.length > 1 && "lg:grid-cols-[280px_1fr]")}>
            {items.length > 1 && (
              <nav className="max-h-40 overflow-y-auto border-b hairline p-2 lg:max-h-none lg:border-b-0 lg:border-r" aria-label={t("bills")}>
                <ul className="space-y-1">
                  {items.map((it, i) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => onIndex(i)}
                        aria-current={i === index}
                        className={clsx("w-full rounded-lg px-3 py-2 text-left text-sm transition-colors duration-[var(--dur-fast)]", i === index ? "bg-signal-bg text-signal-ink" : "hover:bg-sunken")}
                      >
                        <div className="truncate font-medium">{it.title}</div>
                        <div className="truncate text-xs text-muted">{it.filename} · {it.value}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <div className="flex min-h-0 flex-col">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b hairline px-4 py-2 text-sm sm:px-5">
                <span className="inline-flex items-center gap-1.5 font-medium"><FileText className="size-4 text-muted" aria-hidden />{item.filename}</span>
                <span className="text-muted">{t("page", { n: item.page })}</span>
                <span className="text-muted">{t("counted")}: <b className="font-medium tabular text-ink">{item.value}</b></span>
                {items.length > 1 && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label={t("prev")}><ChevronLeft className="size-4" aria-hidden /></button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={index === items.length - 1} onClick={() => onIndex(index + 1)} aria-label={t("next")}><ChevronRight className="size-4" aria-hidden /></button>
                  </span>
                )}
              </div>
              {(item.note || (item.checks?.length ?? 0) > 0) && (
                <div className="space-y-1.5 border-b hairline px-4 py-2 sm:px-5">
                  {item.note && <div className="text-xs text-muted">{item.note}</div>}
                  <CheckPills checks={item.checks} />
                </div>
              )}

              <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-sunken p-3 sm:p-4">
                {failed ? (
                  <div className="grid h-full min-h-40 place-items-center text-sm text-muted">{t("loadError")}</div>
                ) : (
                  <div className="relative mx-auto w-full max-w-[860px] overflow-hidden rounded-md bg-raised shadow-[var(--shadow-raised)]">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img ref={img} src={src} alt={t("alt", { name: item.filename ?? "" })} className="block w-full" onLoad={onLoad} />
                    ) : (
                      <div className="skeleton aspect-[3/4] w-full" />
                    )}
                    {b && loaded && (
                      <motion.div
                        key={item.id}
                        aria-hidden
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.22, delay: 0.1, ease: EASE }}
                        className="pointer-events-none absolute inset-0 overflow-hidden"
                      >
                        <div data-spotlight className="absolute rounded-md ring-2 ring-signal shadow-[0_0_0_9999px_rgba(22,24,24,0.42)]" style={style} />
                        {!reduce && (
                          <motion.div
                            className="absolute rounded-md border-2 border-signal"
                            style={style}
                            initial={{ opacity: 0.9, transform: "scale(1)" }}
                            animate={{ opacity: 0, transform: "scale(1.12)" }}
                            transition={{ duration: 0.9, delay: 0.35, repeat: 2, ease: EASE }}
                          />
                        )}
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
