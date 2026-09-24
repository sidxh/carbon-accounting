"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight, BookOpenCheck, ClipboardList, FileSpreadsheet, Link2, MessageSquareText, Receipt, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";

const EASE = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.05, margin: "0px 0px 20% 0px" }} transition={{ duration: 0.6, delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

/** A real-looking inventory row expanded: the product's core promise, drawn as UI. */
function LineageMock() {
  const t = useTranslations("landing.mock");
  return (
    <div className="card overflow-hidden text-left shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between gap-2 border-b hairline px-4 py-2.5 text-xs text-muted">
        <span className="flex items-center gap-2"><ClipboardList className="size-3.5" aria-hidden />{t("header")}</span>
        <span className="pill pill-primary">{t("tier")}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-sm">
        <div><div className="font-medium">{t("row")}</div><div className="text-xs text-muted">{t("rowSub")}</div></div>
        <div className="font-display text-2xl tabular">28.06 <span className="font-sans text-xs text-muted">tCO2e</span></div>
      </div>
      <ol className="space-y-3 border-t hairline bg-sunken/60 px-4 py-4 text-sm">
        {[
          [1, t("s1"), t("s1b")],
          [2, t("s2"), t("s2b")],
          [3, t("s3"), t("s3b")],
          [4, t("s4"), "42,569 kWh × 0.6592 = 28,061 kgCO2e"],
        ].map(([n, a, b]) => (
          <motion.li key={String(n)} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.15 * Number(n), ease: EASE }} className="flex gap-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-semibold text-raised">{n}</span>
            <div><div className="text-xs font-semibold uppercase tracking-wider text-muted">{a}</div><div className={Number(n) === 4 ? "font-mono text-xs" : "text-xs text-ink-soft"}>{b}</div></div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

const STEPS: { icon: LucideIcon; key: string }[] = [
  { icon: Receipt, key: "bills" },
  { icon: MessageSquareText, key: "questions" },
  { icon: ClipboardList, key: "inventory" },
  { icon: FileSpreadsheet, key: "questionnaire" },
];

const TRUST: { icon: LucideIcon; key: string }[] = [
  { icon: BookOpenCheck, key: "factors" },
  { icon: Link2, key: "lineage" },
  { icon: ShieldCheck, key: "honest" },
  { icon: FileSpreadsheet, key: "outputs" },
];

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const t = useTranslations("landing");
  const tc = useTranslations();

  useEffect(() => {
    if (!loading && user) router.replace("/documents");
  }, [user, loading, router]);

  return (
    <div className="min-h-dvh overflow-x-clip">
      {/* Floating nav ------------------------------------------------------------ */}
      <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3">
        <nav className="card pointer-events-auto flex w-full max-w-4xl items-center justify-between gap-3 px-3 py-2 shadow-[var(--shadow-raised)] sm:px-4" aria-label={t("navLabel")}>
          <Link href="/" className="rounded-lg"><Wordmark /></Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <Link href={user ? "/documents" : "/sign-in"} className="btn btn-sm">
              {user ? t("continue") : tc("app.signIn")}<ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero ---------------------------------------------------------------------- */}
        <section className="relative mx-auto max-w-4xl px-4 pb-16 pt-32 text-center sm:pt-40">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="eyebrow justify-center">{t("eyebrow")}</motion.p>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05, ease: EASE }} className="font-display mx-auto mt-5 max-w-3xl text-[2.75rem] leading-[0.98] text-ink sm:text-[4.5rem]">
            {t("h1a")}<br /><em className="italic text-signal-ink">{t("h1b")}</em>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15, ease: EASE }} className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            {t("sub")}
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25, ease: EASE }} className="mt-8 flex flex-col items-center gap-3">
            <Link href="/sign-in" className="btn px-6 text-base">{t("cta")}<ArrowRight className="size-4" aria-hidden /></Link>
            <span className="text-sm text-muted">{t("ctaSub")}</span>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.35, ease: EASE }} className="mx-auto mt-14 max-w-xl">
            <LineageMock />
          </motion.div>
        </section>

        {/* How it works ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-4 py-16" aria-labelledby="how-h">
          <Reveal className="text-center">
            <p className="eyebrow justify-center">{t("howEyebrow")}</p>
            <h2 id="how-h" className="font-display mt-3 text-3xl sm:text-4xl">{t("howTitle")}</h2>
          </Reveal>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, key }, i) => (
              <Reveal key={key} delay={i * 0.08}>
                <li className="card flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-[10px] bg-signal-bg text-signal-ink"><Icon className="size-5" aria-hidden /></span>
                    <span className="font-display text-2xl text-faint">0{i + 1}</span>
                  </div>
                  <div className="font-display text-xl">{t(`steps.${key}.title`)}</div>
                  <p className="text-sm leading-relaxed text-muted">{t(`steps.${key}.body`)}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Trust ------------------------------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-4 py-16" aria-labelledby="trust-h">
          <div className="card grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr]">
            <Reveal>
              <p className="eyebrow">{t("trustEyebrow")}</p>
              <h2 id="trust-h" className="font-display mt-3 text-3xl leading-tight sm:text-4xl">{t("trustTitle")}</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-muted">{t("trustBody")}</p>
            </Reveal>
            <ul className="grid gap-4 sm:grid-cols-2">
              {TRUST.map(({ icon: Icon, key }, i) => (
                <Reveal key={key} delay={i * 0.06}>
                  <li className="flex gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft"><Icon className="size-4" aria-hidden /></span>
                    <div><div className="font-medium">{t(`trust.${key}.title`)}</div><p className="mt-0.5 text-sm text-muted">{t(`trust.${key}.body`)}</p></div>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA ---------------------------------------------------------------------------- */}
        <section className="mx-auto max-w-3xl px-4 pb-20 pt-4 text-center">
          <Reveal>
            <h2 className="font-display text-3xl sm:text-4xl">{t("finalTitle")}</h2>
            <p className="mt-3 text-muted">{t("finalBody")}</p>
            <Link href="/sign-in" className="btn mt-6 px-6 text-base">{t("cta")}<ArrowRight className="size-4" aria-hidden /></Link>
          </Reveal>
        </section>
      </main>

      <footer className="border-t hairline">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>{t("footerNote")}</span>
          <div className="flex items-center gap-3"><span>{t("footerLangs")}</span><LanguageSwitcher /></div>
        </div>
      </footer>
    </div>
  );
}
