"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Menu } from "@base-ui/react";
import { ArrowLeft, Check, ChevronDown, ClipboardList, FileSpreadsheet, Globe, Lock, LogOut, MessageSquareText, Receipt, Settings2, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { firebaseAuth } from "@/lib/firebase";
import type { Progress } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Wordmark } from "./brand/logo-mark";
import { LanguageSwitcher, LANGUAGE_NAMES, setLocaleCookie } from "./language-switcher";

export type StepKey = "documents" | "reconcile" | "inventory" | "questionnaire";

export const STEPS: { key: StepKey; icon: LucideIcon }[] = [
  { key: "documents", icon: Receipt },
  { key: "reconcile", icon: MessageSquareText },
  { key: "inventory", icon: ClipboardList },
  { key: "questionnaire", icon: FileSpreadsheet },
];

/** Which steps the period's progress has unlocked. Bills is always open. */
export function unlocked(progress: Progress): Record<StepKey, boolean> {
  return {
    documents: true,
    reconcile: progress.bills,
    inventory: progress.questions,
    questionnaire: progress.inventory,
  };
}

/** The step a request should resume at. */
export function nextStep(progress: Progress, filled: boolean): StepKey {
  if (filled) return "questionnaire";
  if (progress.inventory) return "questionnaire";
  if (progress.questions) return "inventory";
  if (progress.bills) return "reconcile";
  return "documents";
}

export { Wordmark };

const menuItem =
  "flex min-h-10 w-full cursor-default items-center gap-2 rounded-[var(--radius-sm)] px-2 text-sm text-ink outline-none select-none data-[highlighted]:bg-sunken";

/**
 * Account menu on Base UI Menu: keyboard navigation, typeahead, focus return
 * and outside-click come from the primitive. Language is a radio group so the
 * whole menu is one keyboard surface.
 */
export function AccountMenu() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { user } = useAuth();
  const who = user?.phoneNumber ?? user?.email ?? "";

  return (
    <Menu.Root>
      <Menu.Trigger className="btn btn-secondary btn-sm gap-1.5 pl-2.5">
        <span className="grid size-6 place-items-center rounded-full bg-sunken text-[11px] font-semibold text-ink-soft" aria-hidden>{who.slice(-2) || "•"}</span>
        <span className="hidden max-w-[140px] truncate font-mono text-xs sm:inline">{who}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-menu outline-none">
          <Menu.Popup
            className={cn(
              "card w-64 origin-[var(--transform-origin)] p-2 shadow-[var(--shadow-float)] outline-none",
              "transition-[transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            )}
          >
            <div className="px-2 py-1.5 text-xs text-muted">{t("app.signedInAs")}</div>
            <div className="truncate px-2 pb-2 font-mono text-sm text-ink">{who}</div>
            <Menu.Separator className="my-1 border-t hairline" />
            <Menu.Item className={menuItem} onClick={() => router.push("/setup")}>
              <Settings2 className="size-4 text-muted" aria-hidden />
              {t("app.company")}
            </Menu.Item>
            <Menu.Separator className="my-1 border-t hairline" />
            <Menu.Group>
              <Menu.GroupLabel className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted"><Globe className="size-3.5" aria-hidden />{t("app.language")}</Menu.GroupLabel>
              <Menu.RadioGroup value={locale} onValueChange={(v) => { setLocaleCookie(String(v)); router.refresh(); }}>
                {Object.entries(LANGUAGE_NAMES).map(([k, v]) => (
                  <Menu.RadioItem key={k} value={k} className={menuItem}>
                    <Menu.RadioItemIndicator className="grid size-4 place-items-center data-[unchecked]:opacity-0" keepMounted>
                      <Check className="size-3.5 text-signal" aria-hidden />
                    </Menu.RadioItemIndicator>
                    <span lang={k}>{v}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="my-1 border-t hairline" />
            <Menu.Item className={menuItem} onClick={async () => { await signOut(firebaseAuth()); router.replace("/sign-in"); }}>
              <LogOut className="size-4 text-muted" aria-hidden />
              {t("app.signOut")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Four steps for one request. Steps unlock left to right as the period's data
 * arrives; going back is always free. A locked step is not a link: it names
 * what unlocks it, and screen readers hear it as disabled.
 */
export function Stepper({ rid, progress, meta }: { rid: string; progress: Progress; meta?: Partial<Record<StepKey, string>> }) {
  const t = useTranslations();
  const path = usePathname();
  const open = unlocked(progress);
  const idx = STEPS.findIndex((s) => path.includes(`/${s.key}`));
  return (
    <nav aria-label={t("app.steps")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol className="flex min-w-max items-center gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const isOpen = open[s.key];
          const state = !isOpen ? "locked" : i < idx ? "done" : i === idx ? "current" : "todo";
          const Icon = s.icon;
          const inner = (
            <>
              <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-semibold", state === "current" ? "bg-raised/15" : state === "done" ? "bg-signal text-signal-on" : "bg-sunken")}>
                {state === "done" ? <Check className="size-3 text-signal-on" aria-hidden /> : state === "locked" ? <Lock className="size-3" aria-hidden /> : i + 1}
              </span>
              <Icon className="hidden size-4 sm:block" aria-hidden />
              <span className="font-medium">{t(`steps.${s.key}`)}</span>
              {meta?.[s.key] && <span className={cn("tabular text-xs", state === "current" ? "text-raised/70" : "text-muted")}>· {meta[s.key]}</span>}
            </>
          );
          const cls = cn(
            "flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
            state === "current" && "border-ink bg-ink text-raised",
            state === "done" && "border-transparent bg-signal-bg text-signal-ink hover:bg-signal/15",
            state === "todo" && "border-transparent text-muted hover:bg-sunken hover:text-ink",
            state === "locked" && "cursor-not-allowed border-transparent text-faint",
          );
          return (
            <li key={s.key} className="flex items-center">
              {state === "locked" ? (
                <span className={cls} aria-disabled="true" title={t(`stepLock.${s.key}`)} role="link">{inner}</span>
              ) : (
                <Link href={`/r/${rid}/${s.key}`} aria-current={state === "current" ? "step" : undefined} className={cls}>{inner}</Link>
              )}
              {i < STEPS.length - 1 && <span className="mx-0.5 hidden h-px w-3 bg-line-strong sm:block" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Header for the request flow: back to Home, who is asking, which year. */
export function RequestHeader({ customer, periodLabel, sharedWith }: { customer: string; periodLabel: string; sharedWith: string[] }) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Link href="/home" className="btn btn-ghost btn-sm -ml-2 gap-1"><ArrowLeft className="size-4" aria-hidden />{t("app.home")}</Link>
      <span className="text-line-strong" aria-hidden>/</span>
      <span className="font-medium text-ink">{customer}</span>
      <span className="pill pill-muted">{periodLabel}</span>
      {sharedWith.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-muted" title={sharedWith.join(", ")}>
          <Users className="size-3.5" aria-hidden />{t("app.sharedWith", { n: sharedWith.length })}
        </span>
      )}
    </div>
  );
}

export function Shell({ children, header, sub, showAccount = true, wide = false }: { children: React.ReactNode; header?: React.ReactNode; sub?: React.ReactNode; showAccount?: boolean; wide?: boolean }) {
  const { user } = useAuth();
  return (
    <div className={cn("mx-auto flex min-h-dvh w-full flex-col px-4 pb-24 pt-4 sm:px-6", wide ? "max-w-5xl" : "max-w-3xl")}>
      <header className="flex items-center justify-between gap-3">
        <Link href={user ? "/home" : "/"} className="rounded-lg"><Wordmark /></Link>
        <div className="flex items-center gap-2">
          {showAccount ? <AccountMenu /> : <LanguageSwitcher />}
        </div>
      </header>
      {header && <div className="mt-5">{header}</div>}
      {sub && (
        <div className="sticky top-0 z-sticky -mx-4 mt-3 bg-paper/95 px-4 py-2 sm:mx-0 sm:px-0">
          {sub}
        </div>
      )}
      <main className="mt-6 flex-1">{children}</main>
    </div>
  );
}
