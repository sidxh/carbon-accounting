"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { EarthHero } from "@/components/landing/earth-hero";
import { GreenWash, LeafField } from "@/components/landing/leaves";
import { StepsFlow } from "@/components/landing/steps-flow";
import { Features } from "@/components/landing/features";
import { LandscapeFooter } from "@/components/landing/landscape-footer";
import { SiteNav } from "@/components/landing/site-nav";

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

export default function Home() {
  const { user } = useAuth();
  const t = useTranslations("landing");
  // Signed-in visitors are not redirected: the landing stays readable, and the
  // nav and both calls to action lead to the dashboard instead of sign-in.
  const go = user ? "/home" : "/sign-in";
  const cta = user ? t("dashboard") : t("cta");


  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Leaves run behind the whole page; main and footer are positioned so they paint above. */}
      <LeafField />
      {/* Floating nav ------------------------------------------------------------ */}
      <SiteNav signedIn={!!user} />

      <main className="relative">
        <EarthHero go={go} cta={cta} />

        {/* How it works: big rising title, a pinned list that opens each step as you
            scroll (with that step's demo), then the steps carousel. ------------------- */}
        {/* Pulled up into the space under the pinned scene's centred story. */}
        <div className="relative -mt-20">
          <GreenWash />
          <section className="relative mx-auto max-w-6xl px-4 pt-10" aria-labelledby="how-h">
            {/* Pins and plays as the page scrolls. */}
            <StepsFlow title={t("howTitle")} />
          </section>
        </div>

        {/* Features: a C60 molecule bursts into a running headline, then a carousel. */}
        <Features />

        {/* CTA ---------------------------------------------------------------------------- */}
        <section className="mx-auto max-w-3xl px-4 pb-6 pt-4 text-center">
          <Reveal>
            <h2 className="font-display text-3xl text-balance sm:text-4xl">{t("finalTitle")}</h2>
            <p className="mt-3 text-muted">{t("finalBody")}</p>
            <Link href={go} className="btn mt-6 px-6 text-base">{cta}<ArrowRight className="size-4" aria-hidden /></Link>
          </Reveal>
        </section>
      </main>

      <LandscapeFooter go={go} cta={cta} />
    </div>
  );
}
