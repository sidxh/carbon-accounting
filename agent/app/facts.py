"""Facts: every value a questionnaire can ask for, computed once from the inventory.

The Excel filler (a question is mapped to a field, then answered) and the answer packs (a bank
question already names its field) both read from `compute_fact`, so a number is worked out in one
place and a buyer's sheet, a portal pack and the VSME file cannot disagree.

The rule that has held since the first version still holds: code writes every number. A fact that
does not exist (a target nobody stated, a customer share the buyer never gave, a renewable
share no bill carries) comes back flagged, with the reason, and is left for a human.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .advisor import Advice, grid_factor_of, rank_levers
from .energy import canonical_unit, energy_totals, mwh_in, source_quantity
from .models import Assumption, EnergyType, InventoryLine, SupplierProfile
from .repo import InventorySnapshot

_EN = {"kWh", "MWh", "GJ", "MJ", "TJ"}


@dataclass
class PreviousYear:
    """The inventory totals of the reporting year before this one, for year-on-year questions."""
    label: str
    scope1_kg: float
    scope2_location_kg: float

    @property
    def total_kg(self) -> float:
        return self.scope1_kg + self.scope2_location_kg


@dataclass
class FactContext:
    profile: SupplierProfile
    snap: InventorySnapshot
    lines: list[InventoryLine]
    assumptions: list[Assumption] = field(default_factory=list)
    customer_share: float | None = None
    advice: Advice | None = None
    previous: PreviousYear | None = None
    customer_name: str | None = None


@dataclass
class Fact:
    value: str | float | None
    source: str = ""
    flagged: bool = False
    reason: str | None = None


def previous_year_of(repo, supplier_id: str, period) -> PreviousYear | None:
    """The closest earlier period of this supplier that has an inventory, or None in a first year."""
    earlier = [p for p in repo.list_periods(supplier_id) if p.id != period.id and p.end < period.start]
    for p in sorted(earlier, key=lambda x: x.end, reverse=True):
        _, snap = repo.list_inventory(supplier_id, p.id)
        if snap is not None:
            return PreviousYear(f"{p.start:%Y-%m-%d} to {p.end:%Y-%m-%d}", snap.totals.scope1_kg, snap.totals.scope2_location_kg)
    return None


def _open(reason: str, value: str | float | None = None, source: str = "-") -> Fact:
    return Fact(value, source, True, reason)


def _t(kg: float) -> float:
    return round(kg / 1000.0, 2)


def _fuel_summary(lines: list[InventoryLine]) -> str:
    agg: dict[tuple[str, str], float] = {}
    for l in lines:
        if l.scope == 1 and l.energy_type.value != "refrigerant":
            agg[(l.energy_type.value, l.unit.value)] = agg.get((l.energy_type.value, l.unit.value), 0) + l.quantity
    refr = {}
    for l in lines:
        if l.energy_type.value == "refrigerant":
            refr[l.factor_id] = refr.get(l.factor_id, 0) + l.quantity
    parts = [f"{k[0].replace('_', ' ')}: {v:,.0f} {k[1]}" for k, v in sorted(agg.items())]
    if refr:
        parts.append("refrigerant top-ups: " + ", ".join(f"{v:g} kg ({k.split('-')[-1]})" for k, v in refr.items()))
    return "; ".join(parts) if parts else "No fuel consumption recorded."


def _sources(lines: list[InventoryLine]) -> str:
    seen: dict[str, str] = {}
    for l in lines:
        seen.setdefault(l.factor_id, l.factor_citation.split(";")[0])
    return "\n".join(f"- {v}" for v in seen.values())


def _methodology(profile: SupplierProfile, snap: InventorySnapshot, lines: list[InventoryLine], asms: list[Assumption]) -> str:
    est_share = snap.totals.tier_mix.get("estimated", 0.0)
    text = (
        f"GHG Protocol Corporate Standard, operational control boundary, reporting period "
        f"{profile.fiscal_year_start:%d %b %Y} to {profile.fiscal_year_end:%d %b %Y}. "
        "Activity data taken from utility bills, fuel invoices and refrigerant service records; billing periods "
        "straddling the reporting year were apportioned by days. Scope 1 = fuel quantity × published fuel emission "
        "factor (all GHGs, CO2e), plus refrigerant top-ups × IPCC AR5 GWP-100. Scope 2 reported location-based "
        "(national or sub-national grid average) and market-based per the GHG Protocol Scope 2 Guidance hierarchy; "
        "where no residual-mix or contractual factor is published the market-based figure uses the grid average and "
        "this is disclosed. Emission factors (with vintages):\n"
        f"{_sources(lines)}\n"
        f"{len(asms)} assumption(s) recorded and documented in the methodology note; estimated data is "
        f"{est_share:.1%} of Scope 1+2. Biogenic CO2 reported separately."
    )
    return text


def _draft_reductions(advice: Advice | None, lines: list[InventoryLine]) -> str | None:
    """A starting point for "what are you doing to cut emissions", from the advisor's ranked levers.

    Phrased as options under consideration, never as things done: the supplier
    decides what is true and edits or deletes it.
    """
    levers = advice.levers if advice else rank_levers(lines=lines, grid_factor=grid_factor_of(lines))
    items: list[str] = []
    s = advice.solar if advice else None
    if s and s.available and s.annual_kwh > 0:
        items.append(f"rooftop solar of about {s.kwp:,.0f} kWp, covering about {s.share_of_electricity:.0%} of electricity "
                     f"and avoiding about {s.avoided_location_kg / 1000:,.0f} tCO2e a year")
    for lv in [l for l in levers if l.beneficial][:3]:
        lo, hi = lv.saved_min_kg / 1000, lv.saved_max_kg / 1000
        items.append(f"{lv.name.lower()} (about {lo:,.1f}-{hi:,.1f} tCO2e a year)" if hi - lo > 0.05 else f"{lv.name.lower()} (about {hi:,.1f} tCO2e a year)")
    if not items:
        return None
    return "DRAFT, please confirm. Options we are considering: " + "; ".join(items) + ". Figures are estimates from our reduction advisor, not commitments."


def _scale_emission(t_co2e: float, unit: str | None) -> tuple[float, str]:
    """Tonnes, or kilograms when the sheet asks for kg-CO2."""
    if unit and "kg" in unit.lower() and "co2" in unit.lower().replace("₂", "2"):
        return round(t_co2e * 1000.0, 1), " (kg, as the sheet asks)"
    return t_co2e, ""


def _scale_energy(mwh: float, unit: str | None) -> tuple[float, str]:
    u = canonical_unit(unit)
    if u in _EN and u != "MWh":
        v = mwh_in(mwh, u)
        return round(v, 0 if u in ("kWh", "MJ") else 2), f" (converted to {u}, as the sheet asks)"
    return round(mwh, 1), ""


def _energy_mix(lines: list[InventoryLine]) -> str:
    et = energy_totals(lines)
    if not et.by_type_mwh:
        return "No energy consumption recorded."
    parts = [f"{k.replace('_', ' ')} {v:,.1f} MWh ({v / et.total_mwh:.0%})" for k, v in sorted(et.by_type_mwh.items(), key=lambda kv: -kv[1])]
    return "; ".join(parts) + f". Total {et.total_mwh:,.1f} MWh."


def _yoy(cur_kg: float, prev: PreviousYear, this_label: str) -> str:
    cur_t, prev_t = cur_kg / 1000.0, prev.total_kg / 1000.0
    if prev_t <= 0:
        return f"Scope 1+2 (location-based) were {cur_t:,.1f} tCO2e; the previous year had no recorded emissions to compare with."
    pct = (cur_t - prev_t) / prev_t * 100.0
    word = "Remained the same overall" if abs(pct) < 0.5 else ("Increased" if pct > 0 else "Decreased")
    return (f"{word}. Gross Scope 1+2 (location-based) were {cur_t:,.1f} tCO2e in {this_label} against "
            f"{prev_t:,.1f} tCO2e in {prev.label} ({pct:+.1f}%).")


def compute_fact(fld: str, ctx: FactContext, *, unit: str | None = None, energy_type: str | None = None) -> Fact:
    """The answer for one field. `unit` is what the buyer's sheet printed beside the question;
    `energy_type` names the source for an energy_by_source row."""
    p, t, lines = ctx.profile, ctx.snap.totals, ctx.lines
    total_kg = t.scope1_kg + t.scope2_location_kg
    n_s1 = sum(1 for l in lines if l.scope == 1)
    elec_kwh = sum(l.quantity for l in lines if l.scope == 2 and l.basis == "location" and l.energy_type.value == "electricity")

    match fld:
        case "company_name":
            return Fact(p.name or None, "supplier profile") if p.name else _open("needs your answer: add the company name in Company details")
        case "country":
            return Fact(p.country, "supplier profile")
        case "reporting_period":
            return Fact(f"{p.fiscal_year_start:%Y-%m-%d} to {p.fiscal_year_end:%Y-%m-%d}", "supplier profile")
        case "reporting_period_end":
            return Fact(f"{p.fiscal_year_end:%Y-%m-%d}", "supplier profile")
        case "sites":
            return Fact(", ".join(s.name for s in p.sites) or None, "supplier profile")
        case "currency":
            return Fact(p.revenue_currency, "supplier profile") if p.revenue_currency else _open("needs your answer: add the currency in Company details")
        case "employees":
            return (Fact(p.headcount, "supplier profile (headcount)") if p.headcount is not None
                    else _open("needs your answer: add the number of employees in Company details"))
        case "turnover":
            return (Fact(round(p.revenue, 2), f"supplier profile (annual revenue, {p.revenue_currency or 'currency not stated'})")
                    if p.revenue else _open("needs your answer: add annual revenue in Company details"))
        case "sector_code":
            return Fact(p.nace_code, "supplier profile (NACE)") if p.nace_code else _open("needs your answer: add the NACE code in Company details")
        case "scope1_tco2e":
            v, note = _scale_emission(round(t.scope1_kg / 1000.0, 2), unit)
            return Fact(v, f"calculator: {n_s1} Scope 1 lines{note}")
        case "scope2_location_tco2e":
            v, note = _scale_emission(round(t.scope2_location_kg / 1000.0, 2), unit)
            return Fact(v, f"calculator: location-based grid factors{note}")
        case "scope2_market_tco2e":
            v, note = _scale_emission(round(t.scope2_market_kg / 1000.0, 2), unit)
            return Fact(v, f"calculator: market-based per Scope 2 hierarchy{note}")
        case "scope2_both":
            return Fact(f"location-based {t.scope2_location_kg / 1000.0:,.2f} tCO2e; market-based {t.scope2_market_kg / 1000.0:,.2f} tCO2e",
                        "calculator: both Scope 2 methods")
        case "scope1_2_total_tco2e":
            v, note = _scale_emission(round(total_kg / 1000.0, 2), unit)
            return Fact(v, f"calculator: Scope 1 + Scope 2 (location-based){note}")
        case "biogenic_tco2":
            v, note = _scale_emission(round(t.biogenic_kg / 1000.0, 2), unit)
            return Fact(v, f"calculator: biogenic CO2 outside scopes{note}")
        case "electricity_mwh":
            v, note = _scale_energy(elec_kwh / 1000.0, unit)
            return Fact(v, f"sum of electricity activity lines{note}")
        case "renewable_electricity_mwh" | "nonrenewable_electricity_mwh":
            return _open("bills do not show renewable electricity: enter the MWh covered by a green tariff, a PPA or rooftop solar (0 if none)")
        case "total_energy_mwh":
            et = energy_totals(lines)
            if et.skipped:
                return _open("some energy cannot be converted to MWh (" + "; ".join(et.skipped) + "): enter the total yourself",
                             source="energy lines with a published calorific value")
            v, note = _scale_energy(et.total_mwh, unit)
            how = "electricity as billed" + (" + fuels at published net calorific values: " + "; ".join(et.citations) if et.citations else "")
            return Fact(v, f"sum of energy lines: {how}{note}")
        case "energy_by_source":
            if energy_type is None:
                return Fact(_energy_mix(lines), "sum of energy lines by source")
            et_ = EnergyType(energy_type)
            q, why = source_quantity(lines, et_, canonical_unit(unit))
            name = energy_type.replace("_", " ")
            if q is None and why == "none":
                return _open(f"no {name} in this inventory: enter 0 if none was used, or add the bills", source="-")
            if q is None:
                return _open(f"cannot express {name} in {unit}: {why}")
            return Fact(round(q, 2), f"sum of {name} activity lines" + (f" in {unit}" if unit else ""))
        case "fuel_consumption":
            return Fact(_fuel_summary(lines), "sum of Scope 1 activity lines")
        case "methodology":
            return Fact(_methodology(p, ctx.snap, lines, ctx.assumptions), "generated from calculator lineage")
        case "verification_status":
            return Fact("Not verified. Figures are self-reported from primary documents; an evidence pack (documents, factors, assumptions) is available for third-party assurance.", "stated")
        case "data_quality":
            mix = ", ".join(f"{k} {v:.1%}" for k, v in sorted(t.tier_mix.items()))
            return Fact(f"By share of Scope 1+2 CO2e: {mix}. Primary = metered or invoiced quantity; estimated = documented assumption ({len(ctx.assumptions)} recorded).", "calculator tier mix")
        case "scope3":
            return Fact("Not calculated. Scope 3 is out of scope for this response; Category 1 upstream data can be requested from our suppliers on request.", "stated", True, "Scope 3 not in this inventory")
        case "intensity_per_revenue" | "ghg_intensity_turnover":
            if p.revenue and p.revenue > 0:
                per_million = (total_kg / 1000.0) / (p.revenue / 1_000_000.0)
                return Fact(round(per_million, 3), f"Scope 1+2 ÷ revenue ({p.revenue:,.0f} {p.revenue_currency or ''}), tCO2e per million")
            return _open("needs your answer: add annual revenue in Company details")
        case "emissions_previous_year":
            if ctx.previous is None:
                return _open("no earlier reporting year in this account: add last year's bills, or state that this is your first year")
            return Fact(_yoy(total_kg, ctx.previous, f"{p.fiscal_year_start:%Y-%m-%d} to {p.fiscal_year_end:%Y-%m-%d}"),
                        f"calculator: this year against {ctx.previous.label}")
        case "customer_name":
            return Fact(ctx.customer_name, "request") if ctx.customer_name else _open("customer not named on this request")
        case "allocation_scope":
            return Fact("Scope 1 and Scope 2 (location-based)", "calculator")
        case "allocation_level":
            return Fact("Company wide", "calculator")
        case "allocation_tco2e":
            if ctx.customer_share is None:
                return _open("customer's share of purchases not provided")
            return Fact(_t(total_kg * ctx.customer_share), f"calculator × customer share ({ctx.customer_share:.1%})")
        case "allocation_to_customer":
            if ctx.customer_share is not None:
                return Fact(f"{_t(total_kg * ctx.customer_share)} tCO2e — {ctx.customer_share:.1%} of Scope 1+2, allocated by share of revenue/output purchased",
                            "calculator × customer share")
            return _open("customer's share of purchases not provided")
        case "energy_tracking":
            et = energy_totals(lines)
            names = ", ".join(k.replace("_", " ") for k in sorted(et.by_type_mwh))
            if not names:
                return _open("no energy recorded in this inventory")
            return Fact(f"Yes. Quantities for {names} come from invoices and meter readings.", "documents in this inventory",
                        True, "confirm that no other energy source goes untracked")
        case "reduction_target":
            return _open("a target is a commitment: to be stated by the supplier")
        case "reduction_activities":
            draft = _draft_reductions(ctx.advice, lines)
            if draft:
                return Fact(draft, "reduction advisor (draft)", True, "drafted from the reduction advisor; confirm before sending")
            return _open("to be stated by the supplier — not derivable from bills")
    return _open(f"unmapped field {fld}")
