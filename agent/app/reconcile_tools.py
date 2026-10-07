"""Deterministic reconciliation. Pure functions over activity lines.

These do the work a consultant does on a spreadsheet: normalise units,
throw out the bill that was photographed twice, cut billing periods to the
fiscal year, and notice the quarter with no invoices. The agent only phrases
the question that comes out the other end.
"""

from __future__ import annotations

import calendar
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

from .checks import failed, with_check
from .models import ActivityLine, Assumption, EnergyType, LineCheck, Unit
from .units import ConversionError, convert

# Energy carriers that arrive as periodic bills and therefore *should* cover
# every month. Deliveries (diesel drums) and one-off service (refrigerant) are
# lumpy by nature and are not treated as gaps.
PERIODIC: set[EnergyType] = {
    EnergyType.ELECTRICITY,
    EnergyType.NATURAL_GAS,
    EnergyType.LPG,
    EnergyType.PURCHASED_STEAM,
    EnergyType.PURCHASED_COOLING,
}


@dataclass
class Issue:
    id: str
    kind: str  # gap | unit_hours | duplicate | site_unknown | low_confidence | index_mismatch | price_implausible | outlier
    energy_type: EnergyType | None
    line_ids: list[str] = field(default_factory=list)
    months: list[str] = field(default_factory=list)  # YYYY-MM
    detail: str = ""
    resolved: bool = False


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# --- 1. units -----------------------------------------------------------------

def normalize_units(lines: list[ActivityLine]) -> tuple[list[ActivityLine], list[Issue]]:
    """Bring every line to the unit its factor will be expressed in.

    kWh for electricity, kg for LPG and refrigerant, L for liquid fuels, m3
    for gas. Generator hours cannot be converted without a rated-consumption
    assumption, so they surface as an issue rather than a guess.
    """
    target: dict[EnergyType, Unit] = {
        EnergyType.ELECTRICITY: Unit.KWH,
        EnergyType.PURCHASED_COOLING: Unit.KWH,
        EnergyType.PURCHASED_STEAM: Unit.GJ,
        EnergyType.LPG: Unit.KG,
        EnergyType.REFRIGERANT: Unit.KG,
        EnergyType.DIESEL: Unit.LITRE,
        EnergyType.PETROL: Unit.LITRE,
        EnergyType.KEROSENE: Unit.LITRE,
        EnergyType.NATURAL_GAS: Unit.M3,
        EnergyType.COAL: Unit.KG,
        EnergyType.BIOMASS: Unit.KG,
    }
    out: list[ActivityLine] = []
    issues: list[Issue] = []
    for ln in lines:
        if ln.unit == Unit.HOUR:
            issues.append(Issue(_new_id("iss"), "unit_hours", ln.energy_type, [ln.id],
                                detail=f"{ln.quantity:g} h of {ln.energy_type} runtime; litres/hour needed"))
            out.append(ln)
            continue
        want = target.get(ln.energy_type)
        if want is None or ln.unit == want:
            out.append(ln)
            continue
        try:
            qty = convert(ln.quantity, ln.unit, want, ln.energy_type)
        except ConversionError:
            out.append(ln)
            continue
        out.append(ln.model_copy(update={
            "quantity": qty, "unit": want,
            "notes": (ln.notes + f" | converted from {ln.quantity:g} {ln.unit}").strip(" |"),
        }))
    return out, issues


# --- 2. duplicates ---------------------------------------------------------------

def _overlap_days(a: ActivityLine, b: ActivityLine) -> int:
    start = max(a.period_start, b.period_start)
    end = min(a.period_end, b.period_end)
    return (end - start).days + 1 if end >= start else 0


def dedupe_overlaps(lines: list[ActivityLine]) -> tuple[list[ActivityLine], list[Issue]]:
    """Drop lines that are the same bill read twice.

    Same site, same energy type, quantities within 0.5 %, and periods that
    overlap by at least 90 % of the shorter one. The kept line records which
    document it also appeared in so the lineage stays complete.
    """
    kept: list[ActivityLine] = []
    issues: list[Issue] = []
    for ln in sorted(lines, key=lambda l: (l.period_start, l.source_doc_id)):
        dup_of = None
        for k in kept:
            if k.energy_type != ln.energy_type or (k.site_id or "") != (ln.site_id or ""):
                continue
            if k.unit != ln.unit or k.quantity == 0:
                continue
            if abs(k.quantity - ln.quantity) / k.quantity > 0.005:
                continue
            shorter = min((k.period_end - k.period_start).days, (ln.period_end - ln.period_start).days) + 1
            if _overlap_days(k, ln) >= 0.9 * shorter:
                dup_of = k
                break
        if dup_of is None:
            kept.append(ln)
        else:
            dup_of.notes = (dup_of.notes + f" | also in document {ln.source_doc_id} (duplicate dropped)").strip(" |")
            issues.append(Issue(_new_id("iss"), "duplicate", ln.energy_type, [ln.id, dup_of.id],
                                detail=f"{ln.quantity:g} {ln.unit} {ln.period_start}–{ln.period_end} appears twice",
                                resolved=True))
    return kept, issues


# --- 3. fiscal year ------------------------------------------------------------------

def apportion_to_fiscal_year(
    lines: list[ActivityLine], fy_start: date, fy_end: date
) -> tuple[list[ActivityLine], list[str]]:
    """Cut billing periods to the reporting year, pro-rating by days.

    A bill for 05 Dec–04 Jan contributes 27/31 of its kWh to the year ending
    31 Dec. Lines wholly outside the year are dropped and reported.
    """
    out: list[ActivityLine] = []
    dropped: list[str] = []
    for ln in lines:
        if ln.period_end < fy_start or ln.period_start > fy_end:
            dropped.append(ln.id)
            continue
        if ln.period_start >= fy_start and ln.period_end <= fy_end:
            out.append(ln)
            continue
        total_days = (ln.period_end - ln.period_start).days + 1
        s = max(ln.period_start, fy_start)
        e = min(ln.period_end, fy_end)
        inside = (e - s).days + 1
        share = inside / total_days
        out.append(ln.model_copy(update={
            "quantity": ln.quantity * share,
            "period_start": s,
            "period_end": e,
            "tier": ln.tier,  # pro-rating a metered bill keeps it primary
            "notes": (ln.notes + f" | {inside}/{total_days} days apportioned to FY").strip(" |"),
        }))
    return out, dropped


# --- 4. gaps ------------------------------------------------------------------------

def _months_between(start: date, end: date) -> list[str]:
    months = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return months


def _covered_months(ln: ActivityLine) -> set[str]:
    # A month counts as covered if the line covers at least 10 days of it.
    covered = set()
    for ym in _months_between(ln.period_start, ln.period_end):
        y, m = map(int, ym.split("-"))
        ms, me = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
        days = (min(me, ln.period_end) - max(ms, ln.period_start)).days + 1
        if days >= 10 or days == (me - ms).days + 1:
            covered.add(ym)
    return covered


def find_gaps(lines: list[ActivityLine], fy_start: date, fy_end: date) -> list[Issue]:
    """Months inside the year with no coverage, per periodic energy type and site."""
    issues: list[Issue] = []
    fy_months = _months_between(fy_start, fy_end)
    groups: dict[tuple[EnergyType, str], list[ActivityLine]] = {}
    for ln in lines:
        if ln.energy_type in PERIODIC:
            groups.setdefault((ln.energy_type, ln.site_id or ""), []).append(ln)
    for (et, site), ls in groups.items():
        covered: set[str] = set()
        for ln in ls:
            covered |= _covered_months(ln)
        missing = [m for m in fy_months if m not in covered]
        if missing:
            issues.append(Issue(_new_id("iss"), "gap", et, [l.id for l in ls], months=missing,
                                detail=f"no {et} records for {', '.join(missing)}" + (f" at site {site}" if site else "")))
    return issues


# --- 4b. a month against the carrier's own pattern -----------------------------------------

SEASON_MIN_LINES = 5       # need a pattern before calling anything off it
SEASON_MIN_DAYS = 20       # shorter periods are too noisy per day
SEASON_HIGH = 2.5
SEASON_LOW = 0.35


def seasonal_outliers(lines: list[ActivityLine]) -> list[ActivityLine]:
    """Add a `season` check to each periodic bill: its use per day against the median of its own series.

    Only bills read from documents count (not assumptions), and only when the
    carrier has enough of them to have a pattern. A bill more than 2.5x or less
    than 0.35x the median per day fails; the rest pass. Idempotent, and a check
    the supplier already confirmed is left as it is.
    """
    groups: dict[tuple[EnergyType, str, str], list[ActivityLine]] = {}
    for ln in lines:
        days = (ln.period_end - ln.period_start).days + 1
        if ln.energy_type in PERIODIC and ln.tier == "primary" and days >= SEASON_MIN_DAYS and ln.quantity > 0:
            groups.setdefault((ln.energy_type, ln.site_id or "", ln.unit.value), []).append(ln)
    verdicts: dict[str, LineCheck] = {}
    for (et, _site, unit), ls in groups.items():
        if len(ls) < SEASON_MIN_LINES:
            continue
        per_day = {l.id: l.quantity / ((l.period_end - l.period_start).days + 1) for l in ls}
        vals = sorted(per_day.values())
        n = len(vals)
        median = vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2
        if median <= 0:
            continue
        for l in ls:
            ratio = per_day[l.id] / median
            what = f"{ratio:.1f}x the {et.value.replace('_', ' ')} median of this site ({len(ls)} bills)"
            if ratio >= SEASON_HIGH or ratio <= SEASON_LOW:
                verdicts[l.id] = LineCheck(id="season", status="fail", detail=f"{l.period_start:%b %Y} is {what}")
            else:
                verdicts[l.id] = LineCheck(id="season", status="pass", detail=f"{l.period_start:%b %Y} is in line with the other months ({what})")
    return [with_check(l, verdicts.get(l.id)) for l in lines]


def check_issues(lines: list[ActivityLine], skip_line_ids: set[str]) -> list[Issue]:
    """One question per bill that failed a check, whatever number of checks it failed.

    The first failing check names the kind (index, then price, then season); the
    detail lists every reason so the question can say all of them at once.
    """
    kinds = {"index": "index_mismatch", "price": "price_implausible", "season": "outlier"}
    out: list[Issue] = []
    for l in lines:
        bad = failed(l)
        if not bad or l.id in skip_line_ids:
            continue
        first = sorted(bad, key=lambda c: list(kinds).index(c.id))[0]
        out.append(Issue(_new_id("iss"), kinds[first.id], l.energy_type, [l.id],
                         detail="; ".join(c.detail for c in bad)))
    return out


# --- 5. assumptions -------------------------------------------------------------------

def _month_bounds(ym: str) -> tuple[date, date]:
    y, m = map(int, ym.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def resolve_gap(
    issue: Issue,
    lines: list[ActivityLine],
    *,
    supplier_id: str,
    resolution: str,
    question: str,
    answer: str,
    quantity_per_month: float | None = None,
) -> tuple[list[ActivityLine], Assumption]:
    """Turn the supplier's answer about a gap into recorded lines.

    resolution:
      "zero"                 — the equipment did not run; record 0 for the months.
      "extrapolate_average"  — assume the average of the months that do have data.
      "custom_quantity"      — the supplier gave a figure per month.
    Every created line is tier=estimated and points at the assumption.
    """
    assert issue.kind == "gap" and issue.energy_type is not None
    et = issue.energy_type
    existing = [l for l in lines if l.id in issue.line_ids]
    unit = existing[0].unit if existing else Unit.KWH
    site = existing[0].site_id if existing else None

    if resolution == "zero":
        per_month = 0.0
        method = "supplier confirmed no consumption; zero recorded"
    elif resolution == "custom_quantity":
        if quantity_per_month is None:
            raise ValueError("custom_quantity needs quantity_per_month")
        per_month = float(quantity_per_month)
        method = f"supplier-stated {per_month:g} {unit} per month"
    elif resolution == "extrapolate_average":
        if not existing:
            raise ValueError("no neighbouring data to average")
        # Average monthly quantity across covered months.
        total_days = sum((l.period_end - l.period_start).days + 1 for l in existing)
        total_qty = sum(l.quantity for l in existing)
        per_day = total_qty / total_days if total_days else 0.0
        per_month = per_day * 30.4
        method = f"average of {len(existing)} recorded periods ({per_day:.4g} {unit}/day)"
    else:
        raise ValueError(f"unknown resolution {resolution}")

    asm = Assumption(
        id=_new_id("asm"), supplier_id=supplier_id, question=question, answer=answer,
        applied_to=[], method=method,
    )
    new_lines: list[ActivityLine] = []
    for ym in issue.months:
        ms, me = _month_bounds(ym)
        days = (me - ms).days + 1
        qty = per_month * days / 30.4 if resolution == "extrapolate_average" else per_month
        ln = ActivityLine(
            id=_new_id("al"), supplier_id=supplier_id, source_doc_id=f"assumption:{asm.id}",
            site_id=site, energy_type=et, quantity=qty, unit=unit, period_start=ms, period_end=me,
            confidence=0.5, tier="estimated", assumption_ids=[asm.id], notes=method,
        )
        new_lines.append(ln)
        asm.applied_to.append(ln.id)
    issue.resolved = True
    return new_lines, asm


def resolve_hours(
    issue: Issue,
    lines: list[ActivityLine],
    *,
    supplier_id: str,
    litres_per_hour: float,
    question: str,
    answer: str,
) -> tuple[list[ActivityLine], Assumption]:
    """Convert generator runtime to litres using the supplier's rated consumption."""
    assert issue.kind == "unit_hours"
    asm = Assumption(id=_new_id("asm"), supplier_id=supplier_id, question=question, answer=answer,
                     method=f"{litres_per_hour:g} L/h rated consumption × runtime hours")
    updated: list[ActivityLine] = []
    for ln in lines:
        if ln.id in issue.line_ids:
            updated.append(ln.model_copy(update={
                "quantity": ln.quantity * litres_per_hour, "unit": Unit.LITRE, "tier": "secondary",
                "assumption_ids": ln.assumption_ids + [asm.id],
                "notes": (ln.notes + f" | {ln.quantity:g} h × {litres_per_hour:g} L/h").strip(" |"),
            }))
            asm.applied_to.append(ln.id)
        else:
            updated.append(ln)
    issue.resolved = True
    return updated, asm


def exclude_lines(
    line_ids: list[str], lines: list[ActivityLine], *, supplier_id: str, question: str, answer: str, reason: str
) -> tuple[list[ActivityLine], Assumption]:
    """Remove lines the supplier says are not theirs (landlord's generator, shared meter)."""
    asm = Assumption(id=_new_id("asm"), supplier_id=supplier_id, question=question, answer=answer,
                     applied_to=list(line_ids), method=f"excluded from boundary: {reason}")
    return [l for l in lines if l.id not in set(line_ids)], asm


# --- summary for the UI ----------------------------------------------------------------

_TIER_RANK = {"primary": 3, "secondary": 2, "estimated": 1}


def summarise(lines: list[ActivityLine], issues: list[Issue], dropped_outside_fy: list[str], fy_start: date, fy_end: date) -> dict:
    """What the deterministic pass found, in a shape the Questions page can draw.

    Per energy type: how many bills and lines, the total quantity, and one
    coverage state per fiscal-year month (primary / secondary / estimated /
    missing; `na` for carriers that are deliveries rather than monthly bills).
    Plus the housekeeping the supplier never sees otherwise: duplicates
    dropped, lines outside the year, unit conversions and apportionments.
    """
    months = _months_between(fy_start, fy_end)
    by_type: dict[EnergyType, list[ActivityLine]] = {}
    for ln in lines:
        by_type.setdefault(ln.energy_type, []).append(ln)

    energy = []
    for et, ls in by_type.items():
        docs = {l.source_doc_id for l in ls if not l.source_doc_id.startswith("assumption:")}
        cov: list[str] = []
        if et in PERIODIC:
            for ym in months:
                best = "missing"
                for l in ls:
                    if ym in _covered_months(l) and (best == "missing" or _TIER_RANK.get(l.tier, 0) > _TIER_RANK.get(best, 0)):
                        best = l.tier
                cov.append(best)
        else:
            cov = ["na"] * len(months)
        energy.append({
            "energy_type": et.value,
            "documents": len(docs),
            "lines": len(ls),
            "quantity": round(sum(l.quantity for l in ls), 3),
            "unit": ls[0].unit.value,
            "periodic": et in PERIODIC,
            "coverage": cov,
            "months_missing": sum(1 for c in cov if c == "missing"),
            "months_estimated": sum(1 for c in cov if c == "estimated"),
        })
    energy.sort(key=lambda e: (-e["quantity"] if e["energy_type"] == "electricity" else 0, e["energy_type"]))

    dup = [i for i in issues if i.kind == "duplicate"]
    open_issues = [i for i in issues if not i.resolved and i.kind != "duplicate"]
    resolved = [i for i in issues if i.resolved and i.kind != "duplicate"]
    return {
        "months": months,
        "energy": energy,
        "documents": len({l.source_doc_id for l in lines if not l.source_doc_id.startswith("assumption:")}),
        "lines": len(lines),
        "duplicates_dropped": len(dup),
        "outside_fy": len(dropped_outside_fy),
        "converted": sum(1 for l in lines if "converted from" in (l.notes or "")),
        "apportioned": sum(1 for l in lines if "apportioned to FY" in (l.notes or "")),
        "estimated_lines": sum(1 for l in lines if l.tier == "estimated"),
        "open_issues": len(open_issues),
        "resolved_issues": len(resolved),
    }


# --- pipeline ------------------------------------------------------------------------

@dataclass
class Prepared:
    lines: list[ActivityLine]
    issues: list[Issue]
    dropped_outside_fy: list[str]


def prepare(lines: list[ActivityLine], fy_start: date, fy_end: date) -> Prepared:
    """Run every deterministic step and return the lines plus the open issues."""
    lines, unit_issues = normalize_units(lines)
    lines, dup_issues = dedupe_overlaps(lines)
    lines, dropped = apportion_to_fiscal_year(lines, fy_start, fy_end)
    gap_issues = find_gaps(lines, fy_start, fy_end)
    lines = seasonal_outliers(lines)
    low_conf = [
        Issue(_new_id("iss"), "low_confidence", l.energy_type, [l.id],
              detail=f"read with confidence {l.confidence:.2f}: {l.quantity:g} {l.unit} {l.period_start}")
        for l in lines if l.confidence < 0.7 and l.tier == "primary"
    ]
    # A bill we already doubt for its legibility is asked about once, not twice.
    self_check = check_issues(lines, {i.line_ids[0] for i in low_conf})
    return Prepared(lines=lines, issues=unit_issues + dup_issues + gap_issues + low_conf + self_check, dropped_outside_fy=dropped)
