"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Wordmark } from "@/components/shell";
import { GROUND, Landscape } from "./landscape";

// What the numbers are cited from (see EVALUATION.md, sections 2 and 5): the methods and
// questionnaires, and the publishers of the emission factors.
const STANDARDS = [
  { name: "GHG Protocol", href: "https://ghgprotocol.org" },
  { name: "GHG Protocol Scope 2 Guidance", href: "https://ghgprotocol.org/scope-2-guidance" },
  { name: "IPCC 2006 Guidelines", href: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html" },
  { name: "IPCC EFDB", href: "https://www.ipcc-nggip.iges.or.jp/EFDB/" },
  { name: "CDP SME questionnaire", href: "https://cdn.cdp.net/cdp-production/comfy/cms/files/files/000/009/090/original/CDP_2024_SME_Questionnaire_-_PDF_export.pdf" },
  { name: "EFRAG VSME template", href: "https://xbrl.efrag.org/downloads/vsme/VSME-Digital-Template-1.3.0.xlsx" },
];
const FACTORS = [
  { name: "UK Government (DEFRA)", href: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting" },
  { name: "Japan, Ministry of the Environment", href: "https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html" },
  { name: "Australia, DCCEEW", href: "https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-accounts-factors" },
  { name: "Vietnam, MONRE", href: "https://dcc.gov.vn/" },
  { name: "Singapore, Energy Market Authority", href: "https://www.ema.gov.sg/resources/singapore-energy-statistics/chapter2" },
  { name: "Thailand, TGO", href: "https://thaicarbonlabel.tgo.or.th/" },
];

/** A column of external sources, each opening in a new tab. */
function SourceList({ items, link }: { items: { name: string; href: string }[]; link: string }) {
  return (
    <ul className="space-y-3">
      {items.map((s) => (
        <li key={s.name}>
          {/* Inline, so on a wrapped name the arrow follows the last word. */}
          <a href={s.href} target="_blank" rel="noreferrer" className={link}>
            {s.name}<ArrowUpRight className="ml-1 inline-block size-3.5 align-[-2px] opacity-60" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The landing footer: an illustrated landscape (misty ridges, a lake, pines, wind
 * turbines, a farmhouse with a solar roof and a big tree) that settles into deep
 * green ground carrying the links: the page's own sections, the standards the
 * numbers are cited from, and the publishers of the emission factors.
 */
export function LandscapeFooter({ go, cta }: { go: string; cta: string }) {
  const t = useTranslations("landing.footer");
  const tl = useTranslations("landing");
  const heading = "mb-4 text-xs font-semibold uppercase text-signal-on/60";
  const link = "text-sm text-signal-on/90 transition-colors hover:text-signal-on";

  return (
    <footer className="relative" style={{ backgroundColor: GROUND }}>
      <div className="bg-paper">
        <Landscape className="hidden h-[290px] w-full sm:block lg:h-[360px]" />
        {/* Phones: the full width would shrink to a sliver, so frame the right-hand scene, farmhouse, tree and hill. */}
        <Landscape className="block h-[250px] w-full sm:hidden" viewBox="780 60 660 360" />
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-signal-on">
        <div className="grid gap-10 border-b border-signal-on/15 pb-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.3fr_1fr] lg:divide-x lg:divide-signal-on/15">
          <div className="lg:pr-8">
            <div className="[&_*]:!text-signal-on"><Wordmark /></div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-signal-on/75">{t("blurb")}</p>
          </div>
          <nav aria-label={t("product")} className="lg:px-8">
            <h2 className={heading}>{t("product")}</h2>
            <ul className="space-y-3">
              <li><Link href="/#how" className={link}>{t("how")}</Link></li>
              <li><Link href="/#features" className={link}>{t("features")}</Link></li>
              <li><Link href="/problem" className={link}>{tl("problem")}</Link></li>
              <li><Link href={go} className={link}>{cta}</Link></li>
            </ul>
          </nav>
          <nav id="standards" aria-label={t("standards")} className="lg:px-8">
            <h2 className={heading}>{t("standards")}</h2>
            <SourceList items={STANDARDS} link={link} />
          </nav>
          <nav aria-label={t("factors")} className="lg:pl-8">
            <h2 className={heading}>{t("factors")}</h2>
            <SourceList items={FACTORS} link={link} />
          </nav>
        </div>
        <div className="flex flex-col gap-2 pt-6 text-xs text-signal-on/60 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} NetZero</span>
          <span>{tl("footerNote")}</span>
        </div>
      </div>
    </footer>
  );
}
