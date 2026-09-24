/**
 * Month coverage, mirroring the agent's rule in reconcile_tools.find_gaps:
 * a month counts as covered when a line covers at least 10 days of it (or
 * all of it, for short months). Used to draw the twelve-cell strips.
 */

export const PERIODIC = new Set(["electricity", "natural_gas", "lpg", "purchased_steam", "purchased_cooling"]);

export type CoverState = "primary" | "secondary" | "estimated" | "missing" | "na";

export interface Period { period_start: string; period_end: string; tier?: string }

export function fyMonths(fyStart: string, fyEnd: string): string[] {
  const out: string[] = [];
  const s = new Date(fyStart + "T00:00:00"), e = new Date(fyEnd + "T00:00:00");
  let y = s.getFullYear(), m = s.getMonth();
  while (y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) { y += 1; m = 0; }
  }
  return out;
}

const DAY = 86_400_000;

function daysInMonth(ym: string): [Date, Date] {
  const [y, m] = ym.split("-").map(Number);
  return [new Date(y, m - 1, 1), new Date(y, m, 0)];
}

function covers(p: Period, ym: string): boolean {
  const [ms, me] = daysInMonth(ym);
  const ps = new Date(p.period_start + "T00:00:00"), pe = new Date(p.period_end + "T00:00:00");
  const s = ps > ms ? ps : ms, e = pe < me ? pe : me;
  if (e < s) return false;
  const days = Math.round((e.getTime() - s.getTime()) / DAY) + 1;
  const monthDays = Math.round((me.getTime() - ms.getTime()) / DAY) + 1;
  return days >= 10 || days === monthDays;
}

const RANK: Record<string, number> = { primary: 3, secondary: 2, estimated: 1 };

/** One state per FY month for a set of lines of the same energy type. */
export function coverage(lines: Period[], months: string[]): CoverState[] {
  return months.map((ym) => {
    let best: CoverState = "missing";
    for (const l of lines) {
      if (!covers(l, ym)) continue;
      const t = (l.tier ?? "primary") as CoverState;
      if (best === "missing" || (RANK[t] ?? 0) > (RANK[best] ?? 0)) best = t;
    }
    return best;
  });
}

export function shortMonth(ym: string, locale?: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "short" });
}

export const ENERGY_ORDER = ["electricity", "lpg", "natural_gas", "diesel", "petrol", "kerosene", "coal", "biomass", "purchased_steam", "purchased_cooling", "refrigerant"];

export function energyLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/^lpg$/, "LPG").replace(/^\w/, (c) => c.toUpperCase());
}
