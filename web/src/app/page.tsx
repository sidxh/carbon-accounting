"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight, BookOpenCheck, FileSpreadsheet, Link2, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";
import { EarthHero } from "@/components/landing/earth-hero";
import { GreenWash, LeafField } from "@/components/landing/leaves";
import { StepsFlow } from "@/components/landing/steps-flow";

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
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Leaves run behind the whole page; main and footer are positioned so they paint above. */}
      <LeafField />
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

      <main className="relative">
        <EarthHero go={go} cta={cta} />

        {/* How it works: big rising title, a pinned list that opens each step as you
            scroll (with that step's demo), then the steps carousel. ------------------- */}
        {/* Pulled up into the space under the pinned scene's centred story. */}
        <div className="relative -mt-20">
          <GreenWash />
          <section className="relative mx-auto max-w-6xl px-4 pb-24 pt-10" aria-labelledby="how-h">
            <Reveal className="text-center">
              <h2 id="how-h" className="font-display text-3xl text-balance sm:text-4xl">{t("howTitle")}</h2>
            </Reveal>
            <Reveal className="mt-10">
              <StepsFlow />
            </Reveal>
          </section>
        </div>

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

      <footer className="relative border-t hairline">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>{t("footerNote")}</span>
          <div className="flex items-center gap-3"><span>{t("footerLangs")}</span><LanguageSwitcher /></div>
        </div>
      </footer>
    </div>
  );
}
