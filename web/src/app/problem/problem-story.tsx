"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-provider";
import { SiteNav } from "@/components/landing/site-nav";

// The problem statement, in plain words for someone outside the industry: the claim at the top, then
// five numbered sections in one ordinary column, on deep green with beige text. Key phrases carry an
// amber wash; facts carry numbered references to the sources at the end. No motion, no product until
// the last line. English only for now.
//
// The facts come from the team's sourced research note (ca-problem-statement-facts-sops-detailed.md),
// plus a teammate's note on who owns carbon work inside a company (Automic Group), the Nordic Council's
// study of how ESG data moves between companies, and the Hong Kong exchange's climate rules. A figure
// with no number after it is our own domain knowledge of how the work is done.

// The sources, keyed so a reference finds its number; the order is the order they are first cited.
const SOURCES = [
  { key: "automic", name: "Automic Group, top five challenges in carbon accounting", href: "https://www.automicgroup.com.au/news/top-5-challenges-in-carbon-accounting-and-how-to-solve-them" },
  { key: "unravel", name: "Unravel Carbon, plans and pricing", href: "https://www.unravelcarbon.com/plans" },
  { key: "ghg", name: "Greenhouse Gas Protocol, corporate and supply-chain standards", href: "https://ghgprotocol.org" },
  { key: "nordic", name: "Nordic Council of Ministers, Green eDocuments in the Nordics (2025)", href: "https://pub.norden.org/temanord2025-532/temanord2025-532.pdf" },
  { key: "trace", name: "Trace Consultants, Scope 3 and climate reporting in the supply chain (Australia)", href: "https://www.traceconsultants.com.au/thinking/scope-3-and-climate-reporting-in-the-supply-chain" },
  { key: "cbampulse", name: "CBAM Pulse, the state of the EU carbon border charge, 2026", href: "https://cbampulse.com/guides/state-of-cbam-2026" },
  { key: "asiaesg", name: "Asia ESG Reporting 2026", href: "https://editorialge.com/mandatory-esg-reporting-asia-2026-issb-analysis/" },
  { key: "acra", name: "Singapore\u2019s company regulator (ACRA), climate reporting timelines", href: "https://www.acra.gov.sg/news-events/news-announcements/887/" },
  { key: "hkex", name: "HKEX, ESG rules and regulations: climate disclosure timeline", href: "https://www.hkex.com.hk/Listing/Sustainability/ESG-Academy/Rules-and-Regulations?sc_lang=en" },
  { key: "greencalc", name: "Green Calculus, Japan\u2019s sustainability disclosure standards", href: "https://greencalculus.com/standards/japan-ssbj-sustainability-disclosure-standards/" },
  { key: "eu", name: "European Commission, the carbon border charge (CBAM)", href: "https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en" },
] as const;
type SourceKey = (typeof SOURCES)[number]["key"];

const ASKING: [string, string, string, SourceKey][] = [
  ["Singapore", "Stock-exchange climate reporting", "from 2026", "acra"],
  ["Hong Kong", "Scope 1 and 2 mandatory for every listed company", "from 2025", "hkex"],
  ["Japan", "Tokyo Stock Exchange", "from 2027", "greencalc"],
  ["Australia", "Corporations Act", "2025\u20132027", "trace"],
  ["European Union", "Carbon charge on imports", "from 2026", "eu"],
];

const kicker = "font-mono text-[11px] uppercase tracking-[0.16em]";

/** A highlighted phrase: an amber wash with dark ink that follows the text across lines. */
function Mark({ children }: { children: React.ReactNode }) {
  return <mark className="rounded-[3px] bg-deep-mark px-1 font-medium text-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">{children}</mark>;
}

/** A numbered reference to the source list at the end. */
function Ref({ k }: { k: SourceKey }) {
  const n = SOURCES.findIndex((s) => s.key === k) + 1;
  return (
    <sup className="ml-0.5">
      <a href={`#source-${n}`} className="font-mono text-[11px] text-deep-accent underline-offset-2 hover:underline" aria-label={`Source ${n}`}>{n}</a>
    </sup>
  );
}

/** One numbered section, set like a newspaper subhead: numeral and title on one line, a small subtitle, then the text. */
function Block({ n, title, subtitle, children }: { n: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`block-${n}`} className="border-t border-deep-line pt-8 first:border-t-0 first:pt-0">
      <h2 id={`block-${n}`} className="font-display text-[1.9rem] leading-tight text-on-deep">
        <span className="mr-3 text-[2.8rem] leading-none tracking-[-0.03em] text-deep-accent" aria-hidden>{n}</span>
        {title}
      </h2>
      <p className={cn(kicker, "mt-1 text-deep-accent/90")}>{subtitle}</p>
      <div className="mt-4 space-y-4 text-[1.0625rem] leading-relaxed text-pretty text-on-deep-soft">{children}</div>
    </section>
  );
}

const nowrap = "whitespace-nowrap";

export function ProblemStory() {
  const { user } = useAuth();
  const t = useTranslations("landing");
  const locale = useLocale();

  return (
    <div className="min-h-dvh overflow-x-clip bg-deep text-on-deep">
      <SiteNav signedIn={!!user} onLanding={false} page="problem" />

      <main className="mx-auto max-w-[900px] px-4 pb-28 sm:px-8">
        {/* The claim. */}
        <div className="pt-28 lg:pt-36">
          {locale !== "en" && <p className="mb-4 text-xs text-on-deep-soft">{t("problemNote")}</p>}
          <p className={cn(kicker, "text-deep-accent")}>Problem statement</p>
          <h1 className="font-display mt-4 text-[clamp(2.3rem,4.4vw,4rem)] leading-[1.03] tracking-[-0.015em] text-balance text-on-deep">
            The world&rsquo;s largest companies now have to count their suppliers&rsquo; carbon. <em className="text-deep-mark">The suppliers have no way to count it.</em>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-on-deep-soft">
            Carbon reporting means adding up the greenhouse gases a business is responsible for, from the fuel it burns and the electricity it buys. It is accounting work, it has to be audit-proof, and the people asked to do it were never hired for it.
          </p>
        </div>

        <div className="mt-16 space-y-10 lg:mt-24">
          <Block n="01" title="Who it hits" subtitle="The people left holding the spreadsheet">
            <p>
              A factory owner in Vietnam, Thailand or Indonesia runs a business of 10 to 200 people, with no environmental team and no accountant who knows carbon. Then a large customer in Japan, Australia, Singapore or Europe sends a spreadsheet: <Mark>count your greenhouse-gas emissions, exactly, within weeks.</Mark>
            </p>
            <p>
              The problem is not only small factories. In many companies of every size, carbon accounting is handed to an existing team, usually Finance or the safety, health, environment and quality (SHEQ) group, <Mark>rather than a sustainability team that does not exist.</Mark> Those teams are already stretched thin, with no spare capacity for a new discipline.<Ref k="automic" />
            </p>
            <p>
              All there is to work from is a stack of paper electricity and fuel bills, often in the local language. Today the owner can ignore the request and lose the next order, guess and fail the audit later, or <Mark>pay a consultant a five-figure sum, every year, for every customer.</Mark> Software built for large companies starts at <span className={nowrap}>US$35,000</span> a year.<Ref k="unravel" />
            </p>
          </Block>

          <Block n="02" title="Why it&rsquo;s hard" subtitle="It is accounting, not a form">
            <p>
              The rules are set by the Greenhouse Gas Protocol and checked by auditors.<Ref k="ghg" /> Bills cover odd dates, so each one is <Mark>split day by day</Mark> into the customer&rsquo;s reporting year. Every fuel and every country&rsquo;s power grid has its own government-published conversion rate, revised yearly and cited by source and year. The same kilowatt-hour counts differently in Japan, Vietnam and Australia.
            </p>
            <p>
              The units alone trip people up: litres of diesel, kilograms of LPG, cubic metres of gas, megajoules on one bill and kilowatt-hours on the next. Gas leaking from an air-conditioner counts, and is usually missed. And one misread digit on a bill can throw a year&rsquo;s total off by an order of magnitude.
            </p>
            <p>
              Then there is the data itself. Everyone says <Mark>&ldquo;we have the data&rdquo;</Mark>, and they do, but it sits across departments in PDFs, scans, phone photos and handwritten delivery slips.<Ref k="automic" /> Most ESG data still moves between companies as emailed attachments in formats no machine can read.<Ref k="nordic" /> And <Mark>every figure needs a paper trail</Mark> back to a bill and a published rate, or the auditor rejects it.
            </p>
          </Block>

          <Block n="03" title="What&rsquo;s at stake" subtitle="For the supplier, and for the customer">
            <p>
              Most of a large company&rsquo;s carbon is its suppliers&rsquo; carbon: <Mark><span className={nowrap}>70 to 90%</span> sits in its supply chain.</Mark><Ref k="ghg" /> So the obligation travels down. In Australia, company directors now sign the climate report, and misleading figures bring fines.<Ref k="trace" /> As audits tighten toward 2030, estimates will stop passing; buyers want figures from real bills.<Ref k="trace" />
            </p>
            <p>
              From 2026 the European Union charges importers for the carbon inside steel, aluminium, cement and fertiliser: <Mark>more than <span className={nowrap}>€600 a tonne</span> of steel</Mark>, by early estimates.<Ref k="cbampulse" /> Suppliers are already being told to provide carbon data or lose the contract.<Ref k="asiaesg" />
            </p>
            <p>
              For a company with several entities or sites, the same problem multiplies. Activity data is scattered across each entity, and someone has to chase every site to be sure nothing is missing.<Ref k="automic" /> One gap, and the whole inventory is incomplete.
            </p>
          </Block>

          <Block n="04" title="Who is asking" subtitle="Five regions, 2025 to 2027">
            <p>No law names the small supplier. <Mark>Every one of them reaches it.</Mark> Stock exchanges and governments make their listed companies and importers report, and those companies in turn ask every supplier for the numbers.</p>
            <dl className="divide-y divide-dashed divide-deep-line border-y border-dashed border-deep-line">
              {ASKING.map(([where, rule, when, ref]) => (
                <div key={where} className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[9rem_1fr_auto]">
                  <dt className="font-display text-xl text-on-deep">{where}</dt>
                  <dd className="col-start-1 row-start-2 text-sm text-on-deep-soft sm:col-start-2 sm:row-start-1">{rule}<Ref k={ref} /></dd>
                  <dd className="col-start-2 row-start-1 font-mono text-xs text-deep-accent sm:col-start-3">{when}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              A business that sells in more than one of these regions has to keep up with all of them, each with its own timeline and its own questionnaire.
            </p>
          </Block>

          <Block n="05" title="Why today&rsquo;s tools miss them" subtitle="Built for a team that is not there">
            <p>
              Carbon software is priced and designed for a company with a sustainability team: <Mark>from US$35,000 a year</Mark>, set up by specialists, fed with data someone has already cleaned.<Ref k="unravel" /> A 60-person factory with a pile of paper bills is not who it was built for.
            </p>
            <p>
              Consultants fill the gap, but one engagement per customer, per year, means the same bills are re-keyed again every time a different buyer sends a different questionnaire: CDP, EcoVadis, Higg, a buyer&rsquo;s own Excel, the EU&rsquo;s VSME template.
            </p>
            <p>
              And a plain &ldquo;AI form filler&rdquo; does not solve it either. The hard part is not typing answers into cells; it is <Mark>reading the bills, finding what is missing, and standing behind every number</Mark> when the auditor asks where it came from.
            </p>
            <p className="pt-2">
              That is the job we are building NetZero to do: be the sustainability team a supplier does not have, from the first bill to the finished questionnaire, with nothing guessed.
            </p>
            <p>
              <Link href={user ? "/home" : "/sign-in"} className="inline-flex items-center gap-2 rounded-full bg-on-deep px-5 py-2.5 text-sm font-medium text-deep transition-colors hover:bg-white">
                {t("cta")}<ArrowRight className="size-4" aria-hidden />
              </Link>
            </p>
          </Block>
        </div>

        {/* Sources --------------------------------------------------------------------- */}
        <section aria-labelledby="sources-h" className="mt-16 border-t border-dashed border-deep-line pt-6">
          <h2 id="sources-h" className={cn(kicker, "text-deep-accent")}>Sources</h2>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-on-deep-soft sm:grid-cols-2">
            {SOURCES.map((s, i) => (
              <li key={s.key} id={`source-${i + 1}`} className="flex scroll-mt-28 gap-2">
                <span className="w-4 shrink-0 font-mono text-deep-accent">{i + 1}</span>
                <a href={s.href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-on-deep hover:underline">{s.name}</a>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-on-deep-soft/80">Research carried out in September and October 2026; every figure with a number after it is sourced.</p>
        </section>
      </main>
    </div>
  );
}
