"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-provider";
import { SiteNav } from "@/components/landing/site-nav";
import { HANDS_SHAPE, ReachingHands } from "./reaching-hands";

// The problem statement, in plain words for someone outside the industry, laid
// out like a newspaper page around a picture: a human hand slanting in from the
// top and a hand of leaves from the left, their fingertips almost touching. The
// picture floats left and the text wraps its outline (CSS shape-outside), so the
// claim runs beside the falling arm and the four numbered sections (who it hits,
// why it is hard, what is at stake, who is asking) start round the fingertips and
// widen below. Key phrases are highlighted; facts carry numbered references to
// the sources at the end. No motion, no product. English only for now. Every fact
// is from the team's sourced research note (ca-problem-statement-facts-sops-detailed.md).

// The sources, in the order they are first cited.
const SOURCES: [string, string][] = [
  ["Unravel Carbon, plans and pricing", "https://www.unravelcarbon.com/plans"],
  ["Greenhouse Gas Protocol, corporate and supply-chain standards", "https://ghgprotocol.org"],
  ["Trace Consultants, Scope 3 and climate reporting in the supply chain (Australia)", "https://www.traceconsultants.com.au/thinking/scope-3-and-climate-reporting-in-the-supply-chain"],
  ["CBAM Pulse, the state of the EU carbon border charge, 2026", "https://cbampulse.com/guides/state-of-cbam-2026"],
  ["Asia ESG Reporting 2026", "https://editorialge.com/mandatory-esg-reporting-asia-2026-issb-analysis/"],
  ["Singapore’s company regulator (ACRA), climate reporting timelines", "https://www.acra.gov.sg/news-events/news-announcements/887/"],
  ["Green Calculus, Japan’s sustainability disclosure standards", "https://greencalculus.com/standards/japan-ssbj-sustainability-disclosure-standards/"],
  ["European Commission, the carbon border charge (CBAM)", "https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en"],
];

const ASKING: [string, string, string, number][] = [
  ["Singapore", "Stock-exchange rules", "from 2026", 6],
  ["Australia", "Corporations Act", "2025–2027", 3],
  ["Japan", "Tokyo Stock Exchange", "from 2027", 7],
  ["European Union", "Carbon charge on imports", "from 2026", 8],
];

const kicker = "font-mono text-[11px] uppercase tracking-[0.16em]";

/** A highlighted phrase: a soft green wash that follows the text across lines. */
function Mark({ children }: { children: React.ReactNode }) {
  return <mark className="rounded-[3px] bg-signal-bg px-1 text-signal-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">{children}</mark>;
}

/** A numbered reference to the source list at the end. */
function Ref({ n }: { n: number }) {
  return (
    <sup className="ml-0.5">
      <a href={`#source-${n}`} className="font-mono text-[11px] text-signal-ink underline-offset-2 hover:underline" aria-label={`Source ${n}`}>{n}</a>
    </sup>
  );
}

/**
 * One numbered section, set like a newspaper subhead so its lines can wrap the
 * picture: the numeral and title on one line, a small subtitle, then the text.
 * (No full-width rule: a rule cannot follow the picture's outline.)
 */
function Block({ n, title, subtitle, children }: { n: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`block-${n}`} className="mt-10 first:mt-0">
      <h2 id={`block-${n}`} className="font-display text-[1.75rem] leading-tight text-ink">
        <span className="mr-3 text-[2.6rem] leading-none tracking-[-0.03em] text-signal-ink" aria-hidden>{n}</span>
        {title}
      </h2>
      <p className={cn(kicker, "mt-1 text-muted")}>{subtitle}</p>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-pretty text-ink-soft">{children}</div>
    </section>
  );
}

const nowrap = "whitespace-nowrap";

export function ProblemStory() {
  const { user } = useAuth();
  const t = useTranslations("landing");
  const locale = useLocale();

  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteNav signedIn={!!user} onLanding={false} page="problem" />

      {/* One column of text, centred; the picture floats into it from the page's left edge. */}
      <main className="mx-auto max-w-[1100px] px-4 pb-24 sm:px-8 lg:px-16">
        {/* The picture. On wide screens it floats left, pulled out to the page edge, and the
            text wraps its outline; on phones it sits above the words. */}
        <div
          className="relative -mx-4 mt-16 aspect-[900/560] sm:-mx-8 lg:float-left lg:mb-4 lg:mt-0 lg:mr-6 lg:w-[50vw] lg:[margin-left:calc((min(100vw,1100px)-100vw)/2-4rem)] lg:[shape-margin:1.25rem]"
          style={{ shapeOutside: HANDS_SHAPE }}
        >
          <ReachingHands className="block size-full" />
        </div>

        {/* The claim, beside the falling arm; its lines step in gently along the picture's outline. */}
        <div className="relative isolate pt-6 lg:pt-28">
          {/* A very light green blob behind the claim (a soft, blurred radial wash; the page's one glow). */}
          <div
            aria-hidden
            className="pointer-events-none absolute -z-10 left-[35%] top-[45%] h-[130%] w-[95%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl lg:left-[62%] lg:top-[58%]"
            style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--signal) 16%, transparent), color-mix(in oklab, var(--signal) 6%, transparent) 55%, transparent)" }}
          />
          {locale !== "en" && <p className="mb-4 text-xs text-muted">{t("problemNote")}</p>}
          <p className={cn(kicker, "text-signal-ink")}>Problem statement</p>
          <h1 className="font-display mt-4 text-[clamp(2.2rem,3.3vw,3.5rem)] leading-[1.03] tracking-[-0.015em] text-balance text-ink">
            The world&rsquo;s largest companies now have to count their suppliers&rsquo; carbon. <em className="text-signal-ink">The suppliers have no way to count it.</em>
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-soft">
            Carbon reporting means adding up the greenhouse gases a business is responsible for, from the fuel it burns and the electricity it buys.
          </p>
        </div>

        {/* The sections, all from the same left edge, below the picture. */}
        <div className="mt-12 lg:clear-left lg:mt-0 lg:pt-2">
          <Block n="01" title="Who it hits" subtitle="The supplier at the bottom of the chain">
            <p>
              A factory owner in Vietnam, Thailand or Indonesia runs a business of 10 to 200 people, with no environmental team and no accountant who knows carbon. Then a large customer in Japan, Australia, Singapore or Europe sends a spreadsheet: <Mark>count your greenhouse-gas emissions, exactly, within weeks.</Mark>
            </p>
            <p>
              All there is to work from is a stack of paper electricity and fuel bills in the local language. Today the owner can ignore it and lose the next order, guess and fail the audit later, or <Mark>pay a consultant a five-figure sum, every year, for every customer.</Mark> Software built for large companies starts at <span className={nowrap}>US$35,000</span> a year.<Ref n={1} />
            </p>
          </Block>

          <Block n="02" title="Why it’s hard" subtitle="It is accounting, not a form">
            <p>
              The rules are set by the Greenhouse Gas Protocol and checked by auditors.<Ref n={2} /> Bills cover odd dates, so each one is <Mark>split day by day</Mark> into the customer&rsquo;s year. Every fuel and every country&rsquo;s power grid has its own government-published conversion rate, revised yearly and cited by source and year.
            </p>
            <p>
              Gas leaking from an air-conditioner counts, and is usually missed. And <Mark>every figure needs a paper trail</Mark> back to a bill and a published rate, or the auditor rejects it.
            </p>
          </Block>

          <Block n="03" title="What’s at stake" subtitle="For the supplier, and for the customer">
            <p>
              Most of a large company&rsquo;s carbon is its suppliers&rsquo; carbon: <Mark><span className={nowrap}>70 to 90%</span> sits in its supply chain.</Mark><Ref n={2} /> So the obligation travels down. In Australia, company directors now sign the climate report, and misleading figures bring fines.<Ref n={3} /> As audits tighten toward 2030, estimates will stop passing; buyers want figures from real bills.<Ref n={3} />
            </p>
            <p>
              From 2026 the European Union charges importers for the carbon inside steel, aluminium, cement and fertiliser: <Mark>more than <span className={nowrap}>€600 a tonne</span> of steel</Mark>, by early estimates.<Ref n={4} /> Suppliers are already being told to provide carbon data or lose the contract.<Ref n={5} />
            </p>
          </Block>

          <Block n="04" title="Who is asking" subtitle="Four regions, 2025 to 2027">
            <p>No law names the small supplier. <Mark>Every one of them reaches it.</Mark></p>
            <dl className="divide-y divide-dashed divide-signal/25 border-y border-dashed border-signal/25">
              {ASKING.map(([where, rule, when, ref]) => (
                <div key={where} className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-0.5 py-2 sm:grid-cols-[9rem_1fr_auto]">
                  <dt className="font-display text-lg text-ink">{where}</dt>
                  <dd className="col-start-1 row-start-2 text-sm text-ink-soft sm:col-start-2 sm:row-start-1">{rule}<Ref n={ref} /></dd>
                  <dd className="col-start-2 row-start-1 font-mono text-xs text-signal-ink sm:col-start-3">{when}</dd>
                </div>
              ))}
            </dl>
          </Block>
        </div>

        {/* Sources --------------------------------------------------------------------- */}
        <section aria-labelledby="sources-h" className="clear-both mt-14 border-t border-dashed border-signal/25 pt-6">
          <h2 id="sources-h" className={cn(kicker, "text-signal-ink")}>Sources</h2>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-ink-soft sm:grid-cols-2">
            {SOURCES.map(([name, href], i) => (
              <li key={href} id={`source-${i + 1}`} className="flex scroll-mt-28 gap-2">
                <span className="w-4 shrink-0 font-mono text-signal-ink">{i + 1}</span>
                <a href={href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-ink hover:underline">{name}</a>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted">Research carried out in September 2026; every figure is sourced.</p>
        </section>
      </main>
    </div>
  );
}
