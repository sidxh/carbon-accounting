"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";

const EASE = [0.23, 1, 0.32, 1] as const;
// The page's sections, by the id of the element that starts each.
const SECTIONS = [
  { id: "how", key: "how" },
  { id: "features", key: "features" },
  { id: "standards", key: "standards" },
] as const;

/**
 * The landing page's floating bar: a cream pill with the wordmark, the page's
 * sections in the middle (a green pill slides behind the one you are in), the
 * language and the way in. A hairline along its foot fills as the page is read.
 * It slides away while scrolling down through the long scenes and comes back on
 * the first scroll up; at the top of the page it always shows. Off the landing
 * page (`onLanding={false}`) the sections link back to it and the button goes home.
 * After the sections, a link to the problem page; on it (`page="problem"`) the
 * pill sits behind that link instead.
 */
export function SiteNav({ signedIn, onLanding = true, page }: { signedIn: boolean; onLanding?: boolean; page?: "problem" }) {
  const t = useTranslations("landing");
  const tc = useTranslations();
  const reduce = useReducedMotion() ?? false;
  const { scrollY, scrollYProgress } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? y;
    if (y < 120) setHidden(false);
    else if (y - prev > 6) setHidden(true);
    else if (prev - y > 6) setHidden(false);

    // The section you are in: the last whose start has passed 40% of the screen.
    if (!onLanding) return;
    const line = window.innerHeight * 0.4;
    let current: string | null = null;
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top <= line) current = s.id;
    }
    setActive(current);
  });
  useMotionValueEvent(scrollYProgress, "change", setProgress);

  const go = (id: string) => (e: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <motion.header
      className="pointer-events-none fixed inset-x-0 top-3 z-header flex justify-center px-3"
      initial={false}
      animate={{ transform: hidden ? "translateY(-140%)" : "translateY(0%)" }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <nav
        aria-label={t("navLabel")}
        className="pointer-events-auto relative flex w-full max-w-5xl items-center justify-between gap-3 overflow-hidden rounded-full border border-signal/15 bg-raised/95 py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-float)]"
      >
        <Link href="/" className="shrink-0 rounded-full" aria-label="NetZero"><Wordmark /></Link>

        {/* Sections, with a green pill sliding behind the current one. */}
        <ul className="hidden items-center gap-0.5 md:flex">
          {SECTIONS.map((s) => {
            const on = active === s.id;
            return (
              <li key={s.id} className="relative">
                {on && (
                  <motion.span
                    layoutId="nav-current"
                    className="absolute inset-0 rounded-full bg-signal-bg"
                    transition={{ duration: 0.4, ease: EASE }}
                    aria-hidden
                  />
                )}
                <a
                  href={onLanding ? `#${s.id}` : `/#${s.id}`}
                  onClick={onLanding ? go(s.id) : undefined}
                  aria-current={on ? "location" : undefined}
                  className={cn("relative block whitespace-nowrap rounded-full px-3.5 py-2 text-sm transition-colors duration-200", on ? "font-medium text-signal-ink" : "text-ink-soft hover:text-ink")}
                >
                  {t(`footer.${s.key}`)}
                </a>
              </li>
            );
          })}
          <li className="relative">
            {page === "problem" && (
              <motion.span layoutId="nav-current" className="absolute inset-0 rounded-full bg-signal-bg" transition={{ duration: 0.4, ease: EASE }} aria-hidden />
            )}
            <Link
              href="/problem"
              aria-current={page === "problem" ? "page" : undefined}
              className={cn("relative block whitespace-nowrap rounded-full px-3.5 py-2 text-sm transition-colors duration-200", page === "problem" ? "font-medium text-signal-ink" : "text-ink-soft hover:text-ink")}
            >
              {t("problem")}
            </Link>
          </li>
        </ul>

        <div className="flex items-center gap-1.5">
          {/* In the bar from lg up (with four links it would crowd a tablet); it is always in the footer. */}
          <LanguageSwitcher className="hidden lg:inline-flex [&_select]:border-transparent [&_select]:bg-transparent" />
          {onLanding ? (
            <Link href={signedIn ? "/home" : "/sign-in"} className="btn btn-sm rounded-full">
              {signedIn ? t("dashboard") : tc("app.signIn")}<ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <Link href="/" className="btn btn-sm btn-secondary rounded-full">
              <ArrowLeft className="size-4" aria-hidden />{t("home")}
            </Link>
          )}
        </div>

        {/* Reading progress along the bar's foot. */}
        <span className="absolute inset-x-6 bottom-0 h-[2px] overflow-hidden rounded-full" aria-hidden>
          <span className="block h-full origin-left bg-signal" style={{ transform: `scaleX(${progress})` }} />
        </span>
      </nav>
    </motion.header>
  );
}
