"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { firebaseAuth } from "@/lib/firebase";
import { LanguageSwitcher } from "./language-switcher";

const STEPS = [
  { href: "/setup", key: "setup" },
  { href: "/documents", key: "documents" },
  { href: "/reconcile", key: "reconcile" },
  { href: "/inventory", key: "inventory" },
  { href: "/questionnaire", key: "questionnaire" },
] as const;

export function Shell({ children, showSteps = true }: { children: React.ReactNode; showSteps?: boolean }) {
  const t = useTranslations();
  const path = usePathname();
  const router = useRouter();
  const idx = STEPS.findIndex((s) => path.startsWith(s.href));

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-16 pt-4 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-sm text-white">SC</span>
          {t("app.name")}
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {showSteps && (
            <button
              className="text-sm text-[var(--muted)] underline-offset-4 hover:underline"
              onClick={async () => {
                await signOut(firebaseAuth());
                router.replace("/sign-in");
              }}
            >
              {t("app.signOut")}
            </button>
          )}
        </div>
      </header>

      {showSteps && (
        <nav className="mt-6 flex gap-1 overflow-x-auto text-sm">
          {STEPS.map((s, i) => (
            <Link
              key={s.href}
              href={s.href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 ${
                i === idx ? "bg-[var(--ink)] text-white" : i < idx ? "bg-[var(--ok-bg)] text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
            >
              {i + 1}. {t(`steps.${s.key}`)}
            </Link>
          ))}
        </nav>
      )}

      <main className="mt-6 flex-1">{children}</main>
    </div>
  );
}
