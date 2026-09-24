"""The calculator. Plain arithmetic, no model anywhere near it.

Input: reconciled activity lines and the factor library. Output: inventory
lines, each carrying the document, factor and assumptions it came from, and
totals by scope, site, energy type and data-quality tier.

Electricity produces two lines per activity line — location-based and
market-based — because the GHG Protocol Scope 2 Guidance asks for both and
buyers' questionnaires have a cell for each. `basis` says which one a row
feeds; `method` says which factor was actually used, so a market row that had
to fall back to the grid average is visible as exactly that.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .factor_library import FactorChoice, FactorLibrary, FactorNotFound
from .models import SCOPE_OF, ActivityLine, EnergyType, InventoryLine, InventoryTotals, Unit
from .units import CANDIDATE_UNITS, ConversionError, convert


@dataclass
class ComputeResult:
    lines: list[InventoryLine]
    totals: InventoryTotals
    skipped: list[tuple[str, str]]  # (activity_line_id, reason)


def _choose_with_conversion(
    lib: FactorLibrary,
    line: ActivityLine,
    *,
    year: int,
    country: str,
    region: str | None,
    scope2_method: str,
) -> tuple[FactorChoice, float, Unit]:
    """Find the most specific factor available, converting units if that is what it takes.

    Geography outranks unit: a national factor expressed in kg beats a generic
    DEFRA factor that happens to be in the line's litres, because the
    conversion is deterministic and the geography is not.
    """
    tried: list[Unit] = [line.unit] + [
        u for u in CANDIDATE_UNITS.get(line.energy_type, []) if u != line.unit
    ]
    last_err: Exception | None = None
    for allow_global in (False, True):
        for unit in tried:
            try:
                qty = convert(line.quantity, line.unit, unit, line.energy_type)
            except ConversionError as e:
                last_err = e
                continue
            try:
                choice = lib.select(
                    energy_type=line.energy_type,
                    year=year,
                    country=country,
                    region=region,
                    unit=unit,
                    scope2_method=scope2_method,
                    gas=line.gas,
                    allow_global=allow_global,
                )
                return choice, qty, unit
            except FactorNotFound as e:
                last_err = e
                continue
    raise FactorNotFound(str(last_err) if last_err else f"no factor for {line.energy_type}")


def compute(
    lines: list[ActivityLine],
    lib: FactorLibrary,
    *,
    reporting_year: int,
    country: str,
    region_by_site: dict[str, str | None] | None = None,
) -> ComputeResult:
    region_by_site = region_by_site or {}
    out: list[InventoryLine] = []
    skipped: list[tuple[str, str]] = []

    for line in lines:
        region = region_by_site.get(line.site_id or "", None)
        scope = SCOPE_OF[line.energy_type]

        if line.unit == Unit.HOUR:
            skipped.append(
                (line.id, "generator hours need a rated-consumption assumption before computing")
            )
            continue

        bases: tuple[str | None, ...] = ("location", "market") if scope == 2 else (None,)
        for basis in bases:
            try:
                choice, qty, unit = _choose_with_conversion(
                    lib,
                    line,
                    year=reporting_year,
                    country=country,
                    region=region,
                    scope2_method=basis or "location",
                )
            except FactorNotFound as e:
                skipped.append((line.id, str(e)))
                break

            f = choice.factor
            kg = qty * f.value
            biogenic = 0.0
            if line.energy_type == EnergyType.BIOMASS:
                bf = lib.biogenic(line.energy_type, reporting_year, unit)
                if bf is not None:
                    biogenic = qty * bf.value

            out.append(
                InventoryLine(
                    id=f"{line.id}:{basis or 'scope1'}",
                    supplier_id=line.supplier_id,
                    site_id=line.site_id,
                    scope=scope,
                    energy_type=line.energy_type,
                    quantity=qty,
                    unit=unit,
                    factor_id=f.id,
                    factor_value=f.value,
                    factor_citation=choice.explanation(),
                    method=f.method,
                    basis=basis,  # type: ignore[arg-type]
                    kg_co2e=kg,
                    biogenic_kg_co2=biogenic,
                    tier=line.tier,
                    source_doc_id=line.source_doc_id,
                    activity_line_id=line.id,
                    assumption_ids=list(line.assumption_ids),
                    period_start=line.period_start,
                    period_end=line.period_end,
                    factor_source_name=f.source_name,
                    factor_source_url=f.source_url,
                    factor_vintage=f.vintage,
                    factor_country=f.country,
                    factor_region=f.region,
                    factor_year=f.year,
                    factor_gas=f.gas,
                    exact_year=choice.exact_year,
                    exact_region=choice.exact_region,
                    fell_back_to=(str(choice.fell_back_to) if choice.fell_back_to else None),
                    activity_notes=line.notes or "",
                )
            )

    return ComputeResult(lines=out, totals=totals(out), skipped=skipped)


def _by_month(headline: list[InventoryLine]) -> dict[str, dict[str, float]]:
    """Spread each headline line over the months it covers, by days, so the
    monthly chart shows a bill for 5 Jan–4 Feb mostly in January."""
    import calendar
    from datetime import date, timedelta

    out: dict[str, dict[str, float]] = {}
    for l in headline:
        total_days = (l.period_end - l.period_start).days + 1
        if total_days <= 0:
            continue
        cur = date(l.period_start.year, l.period_start.month, 1)
        while cur <= l.period_end:
            month_end = date(cur.year, cur.month, calendar.monthrange(cur.year, cur.month)[1])
            s, e = max(cur, l.period_start), min(month_end, l.period_end)
            share = ((e - s).days + 1) / total_days
            ym = f"{cur.year:04d}-{cur.month:02d}"
            bucket = out.setdefault(ym, {"scope1": 0.0, "scope2_location": 0.0, "estimated": 0.0})
            bucket["scope1" if l.scope == 1 else "scope2_location"] += l.kg_co2e * share
            if l.tier == "estimated":
                bucket["estimated"] += l.kg_co2e * share
            cur = month_end + timedelta(days=1)
    return dict(sorted(out.items()))


def totals(lines: list[InventoryLine]) -> InventoryTotals:
    """Roll up. Headline Scope 2 is location-based; market is reported beside it."""
    s1 = [l for l in lines if l.scope == 1]
    s2_loc = [l for l in lines if l.scope == 2 and l.basis == "location"]
    s2_mkt = [l for l in lines if l.scope == 2 and l.basis == "market"]
    headline = s1 + s2_loc  # one row per activity line, no double counting

    by_site: dict[str, dict[str, float]] = defaultdict(
        lambda: {"scope1": 0.0, "scope2_location": 0.0, "scope2_market": 0.0}
    )
    for l in s1:
        by_site[l.site_id or "unassigned"]["scope1"] += l.kg_co2e
    for l in s2_loc:
        by_site[l.site_id or "unassigned"]["scope2_location"] += l.kg_co2e
    for l in s2_mkt:
        by_site[l.site_id or "unassigned"]["scope2_market"] += l.kg_co2e

    by_type: dict[str, float] = defaultdict(float)
    tier_kg: dict[str, float] = defaultdict(float)
    for l in headline:
        by_type[l.energy_type] += l.kg_co2e
        tier_kg[l.tier] += l.kg_co2e

    total_kg = sum(l.kg_co2e for l in headline)
    tier_mix = {t: (kg / total_kg if total_kg else 0.0) for t, kg in tier_kg.items()}

    return InventoryTotals(
        by_month=_by_month(headline),
        scope1_kg=sum(l.kg_co2e for l in s1),
        scope2_location_kg=sum(l.kg_co2e for l in s2_loc),
        scope2_market_kg=sum(l.kg_co2e for l in s2_mkt),
        biogenic_kg=sum(l.biogenic_kg_co2 for l in headline),
        by_site={k: dict(v) for k, v in by_site.items()},
        by_energy_type=dict(by_type),
        tier_mix=tier_mix,
        line_count=len(lines),
    )
