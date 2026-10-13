"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { LANGUAGE_NAMES, setLocaleCookie } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";
import { GROUND, Landscape } from "./landscape";

const STANDARDS = [
  { name: "GHG Protocol", href: "https://ghgprotocol.org" },
  { name: "CDP", href: "https://www.cdp.net" },
  { name: "DEFRA conversion factors", href: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting" },
  { name: "IPCC EFDB", href: "https://www.ipcc-nggip.iges.or.jp/EFDB/" },
];

/**
 * The landing footer: an illustrated landscape (misty ridges, a lake, pines, wind
 * turbines, a farmhouse with a solar roof and a big tree) that settles into deep
 * green ground carrying the links: the page's own sections, the standards the
 * numbers are cited from, and the language.
 */
export function LandscapeFooter({ go, cta }: { go: string; cta: string }) {
  const t = useTranslations("landing.footer");
  const tl = useTranslations("landing");
  const locale = useLocale();
  const router = useRouter();
  const heading = "mb-4 text-xs font-semibold uppercase text-signal-on/60";
  const link = "text-sm text-signal-on/90 transition-colors hover:text-signal-on";

  return (
    <footer className="relative" style={{ backgroundColor: GROUND }}>
      <div className="bg-paper"><Landscape className="block h-[220px] w-full sm:h-[290px] lg:h-[360px]" /></div>
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
            <ul className="space-y-3">
              {STANDARDS.map((s) => (
                <li key={s.name}>
                  <a href={s.href} target="_blank" rel="noreferrer" className={cn(link, "inline-flex items-center gap-1")}>
                    {s.name}<ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="lg:pl-8">
            <h2 className={heading}>{tl("footerLangs")}</h2>
            <ul className="space-y-3">
              {Object.entries(LANGUAGE_NAMES).map(([k, v]) => (
                <li key={k}>
                  <button
                    type="button"
                    lang={k}
                    aria-current={k === locale ? "true" : undefined}
                    onClick={() => { setLocaleCookie(k); router.refresh(); }}
                    className={cn(link, k === locale && "font-semibold text-signal-on underline underline-offset-4")}
                  >
                    {v}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-6 text-xs text-signal-on/60 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Supplier Carbon</span>
          <span>{tl("footerNote")}</span>
        </div>
      </div>
    </footer>
  );
}
