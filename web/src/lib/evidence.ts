import type { ActivityLine, DocumentRecord, InventoryLine } from "./api";
import { energyLabel } from "./coverage";
import type { EvidenceItem } from "@/components/evidence-viewer";

const shortDate = (iso: string, locale?: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "2-digit", month: "short" });

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** The evidence for one inventory line, or null when no bill is behind it (an answer you gave). */
export function evidenceFor(
  line: InventoryLine,
  act: ActivityLine | undefined,
  doc: DocumentRecord | undefined,
  locale?: string,
): EvidenceItem | null {
  if (!doc || line.source_doc_id.startsWith("assumption:")) return null;
  const when =
    line.period_start === line.period_end
      ? shortDate(line.period_start, locale)
      : `${shortDate(line.period_start, locale)} – ${shortDate(line.period_end, locale)}`;
  // The first note is the label the quantity was read from; the rest are what we did to it.
  const rest = (line.activity_notes || act?.notes || "").split(" | ").map((s) => s.trim()).filter(Boolean).slice(1);
  return {
    id: line.activity_line_id,
    docId: doc.id,
    filename: doc.filename,
    page: act?.page ?? 1,
    box: act?.quantity_box ?? null,
    title: `${energyLabel(line.energy_type)} · ${when}`,
    value: `${num(line.quantity)} ${line.unit}`,
    note: rest.length ? rest.join(" · ") : undefined,
    checks: act?.checks,
  };
}

/**
 * Questionnaire answers that are sums of inventory lines, and which lines they
 * sum. Anything not listed (text answers, profile facts) has no bill behind it.
 */
export function linesForField(field: string, lines: InventoryLine[]): InventoryLine[] | null {
  const s1 = (l: InventoryLine) => l.scope === 1;
  const s2loc = (l: InventoryLine) => l.scope === 2 && l.basis === "location";
  switch (field) {
    case "scope1_tco2e":
    case "fuel_consumption":
      return lines.filter(s1);
    case "scope2_location_tco2e":
      return lines.filter(s2loc);
    case "scope2_market_tco2e":
      return lines.filter((l) => l.scope === 2 && l.basis === "market");
    case "scope1_2_total_tco2e":
      return lines.filter((l) => s1(l) || s2loc(l));
    case "electricity_mwh":
      return lines.filter((l) => s2loc(l) && l.energy_type === "electricity");
    case "biogenic_tco2":
      return lines.filter((l) => l.biogenic_kg_co2 > 0);
    default:
      return null;
  }
}

export const hasBillsBehind = (field: string) => linesForField(field, []) !== null;

/** One item per bill line, oldest first, a line counted once even if it feeds two bases. */
export function itemsForLines(
  lines: InventoryLine[],
  acts: Record<string, ActivityLine>,
  docs: Record<string, DocumentRecord>,
  locale?: string,
): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const l of [...lines].sort((a, b) => a.period_start.localeCompare(b.period_start) || a.energy_type.localeCompare(b.energy_type))) {
    if (seen.has(l.activity_line_id)) continue;
    seen.add(l.activity_line_id);
    const it = evidenceFor(l, acts[l.activity_line_id], docs[l.source_doc_id], locale);
    if (it) out.push(it);
  }
  return out;
}
