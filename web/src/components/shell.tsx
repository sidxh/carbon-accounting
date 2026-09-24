"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ClipboardList, FileSpreadsheet, Leaf, LogOut, MessageSquareText, Receipt, Settings2, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { firebaseAuth } from "@/lib/firebase";
import { useAuth } from "./auth-provider";
import { LanguageSwitcher } from "./language-switcher";

export type StepKey = "setup" | "documents" | "reconcile" | "inventory" | "questionnaire";

export const STEPS: { href: string; key: StepKey; icon: LucideIcon }[] = [
  { href: "/setup", key: "setup", icon: Settings2 },
  { href: "/documents", key: "documents", icon: Receipt },
  { href: "/reconcile", key: "reconcile", icon: MessageSquareText },
  { href: "/inventory", key: "inventory", icon: ClipboardList },
  { href: "/questionnaire", key: "questionnaire", icon: FileSpreadsheet },
];

export function Wordmark({ className }: { className?: string }) {
  const t = useTranslations();
  return (
    <span className={clsx("inline-flex items-center gap-2 font-semibold text-ink", className)}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-signal text-signal-on">
        <Leaf className="size-4" aria-hidden />
      </span>
      <span className="font-display text-xl tracking-tight">{t("app.name")}</span>
    </span>
  );
}

function AccountMenu() {
  const t = useTranslations();
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const who = user?.phoneNumber ?? user?.email ?? "";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="btn btn-secondary btn-sm gap-1.5 pl-2.5"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="grid size-6 place-items-center rounded-full bg-sunken text-[11px] font-semibold text-ink-soft" aria-hidden>{who.slice(-2) || "•"}</span>
        <span className="hidden max-w-[140px] truncate font-mono text-xs sm:inline">{who}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-[calc(100%+6px)] z-50 w-64 p-2 shadow-[var(--shadow-float)] rise">
          <div className="px-2 py-1.5 text-xs text-muted">{t("app.signedInAs")}</div>
          <div className="truncate px-2 pb-2 font-mono text-sm text-ink">{who}</div>
          <div className="my-1 border-t hairline" />
          <div className="px-2 py-1.5">
            <div className="label mb-1 !text-xs">{t("app.language")}</div>
            <LanguageSwitcher />
          </div>
          <div className="my-1 border-t hairline" />
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink hover:bg-sunken"
            onClick={async () => { await signOut(firebaseAuth()); router.replace("/sign-in"); }}
          >
            <LogOut className="size-4 text-muted" aria-hidden />
            {t("app.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

export function Stepper({ meta }: { meta?: Partial<Record<StepKey, string>> }) {
  const t = useTranslations();
  const path = usePathname();
  const idx = STEPS.findIndex((s) => path.startsWith(s.href));
  return (
    <nav aria-label={t("app.steps")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol className="flex min-w-max items-center gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const state = i < idx ? "done" : i === idx ? "current" : "todo";
          const Icon = s.icon;
          return (
            <li key={s.href} className="flex items-center">
              <Link
                href={s.href}
                aria-current={state === "current" ? "step" : undefined}
                className={clsx(
                  "flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  state === "current" && "border-ink bg-ink text-raised",
                  state === "done" && "border-transparent bg-signal-bg text-signal-ink hover:bg-signal/15",
                  state === "todo" && "border-transparent text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <span className={clsx("grid size-5 place-items-center rounded-full text-[11px] font-semibold", state === "current" ? "bg-raised/15" : state === "done" ? "bg-signal text-signal-on" : "bg-sunken")}>
                  {state === "done" ? <Check className="size-3" aria-hidden /> : i + 1}
                </span>
                <Icon className="hidden size-4 sm:block" aria-hidden />
                <span className="font-medium">{t(`steps.${s.key}`)}</span>
                {meta?.[s.key] && <span className={clsx("tabular text-xs", state === "current" ? "text-raised/70" : "text-muted")}>· {meta[s.key]}</span>}
              </Link>
              {i < STEPS.length - 1 && <span className="mx-0.5 hidden h-px w-3 bg-line-strong sm:block" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Shell({ children, showSteps = true, stepMeta, wide = false }: { children: React.ReactNode; showSteps?: boolean; stepMeta?: Partial<Record<StepKey, string>>; wide?: boolean }) {
  return (
    <div className={clsx("mx-auto flex min-h-dvh w-full flex-col px-4 pb-24 pt-4 sm:px-6", wide ? "max-w-5xl" : "max-w-3xl")}>
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="rounded-lg"><Wordmark /></Link>
        <div className="flex items-center gap-2">
          {showSteps ? <AccountMenu /> : <LanguageSwitcher />}
        </div>
      </header>

      {showSteps && (
        <div className="sticky top-0 z-40 -mx-4 mt-5 bg-paper/95 px-4 py-2 sm:mx-0 sm:px-0">
          <Stepper meta={stepMeta} />
        </div>
      )}

      <main className="mt-6 flex-1">{children}</main>
    </div>
  );
}
