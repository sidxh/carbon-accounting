"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight, BookOpenCheck, ClipboardList, FileSpreadsheet, Link2, MessageSquareText, Receipt, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";
import { HeroDemo } from "@/components/landing/hero-demo";

// --ease-out from DESIGN.md; --dur-reveal (600 ms) is permitted only on this page.
const EASE = [0.23, 1, 0.32, 1] as const;
const REVEAL = 0.6;

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, transform: "translateY(20px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)" }}
      viewport={{ once: true, amount: 0.05, margin: "0px 0px 20% 0px" }}
      transition={{ duration: REVEAL, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
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
  const { user } = useAuth();
  const t = useTranslations("landing");
  const tc = useTranslations();
  // Signed-in visitors are not redirected: the landing stays readable, and the
  // nav and both calls to action lead to the dashboard instead of sign-in.
  const go = user ? "/home" : "/sign-in";
  const cta = user ? t("dashboard") : t("cta");


  return (
    <div className="min-h-dvh overflow-x-clip">
      {/* Floating nav ------------------------------------------------------------ */}
      <header className="pointer-events-none fixed inset-x-0 top-3 z-header flex justify-center px-3">
        <nav className="card pointer-events-auto flex w-full max-w-4xl items-center justify-between gap-3 px-3 py-2 shadow-[var(--shadow-raised)] sm:px-4" aria-label={t("navLabel")}>
          <Link href="/" className="rounded-lg"><Wordmark /></Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <Link href={user ? "/home" : "/sign-in"} className="btn btn-sm">
              {user ? t("dashboard") : tc("app.signIn")}<ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero ---------------------------------------------------------------------- */}
        <section className="relative mx-auto max-w-4xl px-4 pb-16 pt-32 text-center sm:pt-40">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="eyebrow justify-center">{t("eyebrow")}</motion.p>
          <motion.h1 initial={{ opacity: 0, transform: "translateY(16px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: REVEAL, delay: 0.05, ease: EASE }} className="font-display mx-auto mt-5 max-w-3xl text-[2.75rem] leading-[0.98] text-ink sm:text-[4.5rem]">
            {t("h1a")}<br /><em className="italic text-signal-ink">{t("h1b")}</em>
          </motion.h1>
          <motion.p initial={{ opacity: 0, transform: "translateY(12px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: REVEAL, delay: 0.15, ease: EASE }} className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            {t("sub")}
          </motion.p>
          <motion.div initial={{ opacity: 0, transform: "translateY(12px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: REVEAL, delay: 0.25, ease: EASE }} className="mt-8 flex flex-col items-center gap-3">
            <Link href={go} className="btn px-6 text-base">{cta}<ArrowRight className="size-4" aria-hidden /></Link>
            <span className="text-sm text-muted">{t("ctaSub")}</span>
          </motion.div>

          <motion.div initial={{ opacity: 0, transform: "translateY(32px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: REVEAL, delay: 0.35, ease: EASE }} className="mx-auto mt-14 max-w-2xl">
            <HeroDemo />
          </motion.div>
        </section>

        {/* How it works ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-4 py-16" aria-labelledby="how-h">
          <Reveal className="text-center">
            <p className="eyebrow justify-center">{t("howEyebrow")}</p>
            <h2 id="how-h" className="font-display mt-3 text-3xl text-balance sm:text-4xl">{t("howTitle")}</h2>
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
              <h2 id="trust-h" className="font-display mt-3 text-3xl leading-tight text-balance sm:text-4xl">{t("trustTitle")}</h2>
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
            <h2 className="font-display text-3xl text-balance sm:text-4xl">{t("finalTitle")}</h2>
            <p className="mt-3 text-muted">{t("finalBody")}</p>
            <Link href={go} className="btn mt-6 px-6 text-base">{cta}<ArrowRight className="size-4" aria-hidden /></Link>
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
