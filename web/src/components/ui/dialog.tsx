"use client";

import { useRef } from "react";
import { AlertDialog, Dialog as BaseDialog } from "@base-ui/react";

interface Props {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** "danger" renders an AlertDialog: no outside-click dismissal, destructive styling. */
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}

const backdrop =
  "fixed inset-0 z-dialog bg-ink/40 transition-opacity duration-[var(--dur-enter)] ease-[var(--ease-out)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";
const popup =
  "card fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 p-6 shadow-[var(--shadow-float)] outline-none " +
  "transition-[scale,opacity] duration-[var(--dur-enter)] ease-[var(--ease-out)] " +
  "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0";

/**
 * Confirm dialog on Base UI. Focus management, Escape, scroll lock and
 * focus return come from the primitive. Destructive actions use AlertDialog
 * so a stray tap outside cannot dismiss them.
 */
export function Dialog({ open, title, description, confirmLabel, cancelLabel, tone = "default", busy, onConfirm, onClose, children }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const D = tone === "danger" ? AlertDialog : BaseDialog;
  const descText = typeof description === "string" ? description : undefined;

  return (
    <D.Root open={open} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <D.Portal>
        <D.Backdrop className={backdrop} />
        <D.Popup className={popup} initialFocus={confirmRef}>
          <D.Title className="font-display text-2xl text-balance text-ink">{title}</D.Title>
          {description && (
            <D.Description className="mt-2 text-sm leading-relaxed text-pretty text-muted">{descText ?? description}</D.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
            <button ref={confirmRef} type="button" className={tone === "danger" ? "btn btn-danger" : "btn"} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
          </div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}
