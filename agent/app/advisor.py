"""The reduction advisor. Pure functions over the computed inventory; no network.

Two things come out of it:

* a rooftop-solar option sized to what the site actually uses (never to what
  the roof could produce, because we assume nothing is exported), with the
  tCO2e it avoids on both Scope 2 bases and a payback at the supplier's own
  tariff;
* a ranked list of other levers from a small cited table, each as a tCO2e
  range, kept out of the list when the inventory has nothing for it to act on.

Where the numbers come from is always shown: `precision` says whether the solar
figure was measured from Google's roof model or estimated from irradiance and a
roof area the supplier gave us.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field

from .checks import band_for, normalise_currency
from .models import ActivityLine, EnergyType, InventoryLine
from .settings import get_settings
from .solar import Building

AC_DERATE = 0.85          # Solar API's DC yield to usable AC (the API's own default)
USABLE_ROOF_SHARE = 0.60  # fallback: share of the roof area that can carry panels
KWP_PER_M2 = 0.20         # fallback: panel density, ~400 W per 2 m2


# --- data tables ------------------------------------------------------------------------

@dataclass(frozen=True)
class Lever:
    id: str
    name: str
    kind: str                       # reduce | switch | certificate
    applies_to: str
    basis: str                      # location | market | scope1
    min_pct: float
    max_pct: float
    electric_kwh_per_unit: float
    cost_class: str
    cost_note: str
    source_name: str
    source_url: str
    note: str


@lru_cache(maxsize=1)
def levers() -> tuple[Lever, ...]:
    out: list[Lever] = []
    f = get_settings().levers_dir / "levers.csv"
    if f.exists():
        with f.open(encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                out.append(Lever(r["id"], r["name"], r["kind"], r["applies_to"], r["basis"],
                                 float(r["min_pct"] or 0), float(r["max_pct"] or 0), float(r["electric_kwh_per_unit"] or 0),
                                 r["cost_class"], r["cost_note"], r["source_name"], r["source_url"], r["note"]))
    return tuple(out)


@lru_cache(maxsize=1)
def solar_costs() -> dict[str, dict]:
    f = get_settings().levers_dir / "solar_costs.csv"
    out: dict[str, dict] = {}
    if f.exists():
        with f.open(encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                out[r["country"].upper()] = {"currency": r["currency"].upper(), "per_kwp": float(r["per_kwp"]),
                                             "source_name": r["source_name"], "source_url": r["source_url"], "note": r["note"]}
    return out


# --- results ----------------------------------------------------------------------------

class SolarOption(BaseModel):
    available: bool
    precision: Literal["solar_api", "pvgis_estimate"] | None = None
    needs_roof_area: bool = False
    kwp: float = 0.0
    panels: int | None = None
    annual_kwh: float = 0.0
    share_of_electricity: float = 0.0
    avoided_location_kg: float = 0.0
    avoided_market_kg: float = 0.0
    roof_area_m2: float | None = None
    yield_kwh_per_kwp: float | None = None
    imagery_quality: str | None = None
    imagery_date: date | None = None
    capex: float | None = None
    currency: str | None = None
    capex_source: str = ""
    tariff: float | None = None
    tariff_source: str = ""
    annual_saving: float | None = None
    payback_years: float | None = None
    notes: list[str] = Field(default_factory=list)


class LeverResult(BaseModel):
    id: str
    name: str
    kind: str
    basis: str
    baseline_kg: float
    saved_min_kg: float
    saved_max_kg: float
    saved_mid_kg: float
    beneficial: bool = True
    cost_class: str
    cost_note: str
    source_name: str
    source_url: str
    note: str


class Advice(BaseModel):
    site_id: str | None
    annual_electricity_kwh: float
    scope1_kg: float
    scope2_location_kg: float
    scope2_market_kg: float
    grid_factor: float | None
    market_factor: float | None
    solar: SolarOption
    levers: list[LeverResult]


# --- inventory read-outs -----------------------------------------------------------------

def _site_filter(lines: list[InventoryLine], site_id: str | None, single_site: bool) -> list[InventoryLine]:
    if site_id is None or single_site:
        return lines
    return [l for l in lines if l.site_id == site_id]


def grid_factor_of(lines: list[InventoryLine]) -> float | None:
    """kgCO2e per kWh the inventory actually used for location-based electricity."""
    elec = [l for l in lines if l.scope == 2 and l.basis == "location" and l.energy_type == EnergyType.ELECTRICITY]
    kwh = sum(l.quantity for l in elec)
    return sum(l.kg_co2e for l in elec) / kwh if kwh else None


def own_tariff(lines: list[ActivityLine], country: str | None) -> tuple[float, str, str] | None:
    """Average price per kWh the supplier actually paid, from bills that carry one electricity line.

    The amount on a bill is the whole invoice's, so it is only read as a price
    when the bill has a single energy line (the same rule as the price check).
    Returns (price, currency, description) or None.
    """
    per_doc: dict[str, list[ActivityLine]] = {}
    for l in lines:
        per_doc.setdefault(l.source_doc_id, []).append(l)
    amt = qty = 0.0
    cur: str | None = None
    n = 0
    for ls in per_doc.values():
        if len(ls) != 1:
            continue
        l = ls[0]
        c = normalise_currency(l.currency, country)
        if l.energy_type != EnergyType.ELECTRICITY or l.unit.value != "kWh" or not l.amount or l.quantity <= 0 or not c:
            continue
        if cur is None:
            cur = c
        if c != cur:
            continue
        amt += l.amount
        qty += l.quantity
        n += 1
    if cur is None or qty <= 0:
        return None
    return amt / qty, cur, f"your own bills ({n} electricity bills, all-in incl. taxes)"


def fallback_tariff(country: str | None) -> tuple[float, str, str] | None:
    b = band_for(country, "electricity", _band_currency(country), "kWh")
    if b is None:
        return None
    return (b.low + b.high) / 2, b.currency, "the middle of the usual price range for your country (no bill carried a price)"


def _band_currency(country: str | None) -> str | None:
    return {"VN": "VND", "JP": "JPY", "AU": "AUD"}.get((country or "").upper())


# --- solar ------------------------------------------------------------------------------

def size_solar(
    *, annual_kwh: float, grid_factor: float | None, market_factor: float | None, country: str | None,
    building: Building | None, pvgis_kwh_per_kwp: float | None, roof_area_m2: float | None,
    tariff: tuple[float, str, str] | None,
) -> SolarOption:
    if annual_kwh <= 0:
        return SolarOption(available=False, notes=["No electricity use recorded for this site."])
    notes: list[str] = []
    precision: str
    kwp: float
    kwh: float
    panels: int | None = None
    yield_per_kwp: float | None = None
    quality = date_ = None
    area = roof_area_m2

    if building is not None and building.configs:
        precision = "solar_api"
        quality, date_ = building.imagery_quality, building.imagery_date
        area = building.whole_roof_area_m2 or area
        fits = [c for c in building.configs if c.yearly_dc_kwh * AC_DERATE <= annual_kwh]
        cfg = fits[-1] if fits else building.configs[0]
        panels = cfg.panels
        kwp = cfg.panels * building.panel_capacity_w / 1000
        ac = cfg.yearly_dc_kwh * AC_DERATE
        kwh = min(ac, annual_kwh)
        yield_per_kwp = ac / kwp if kwp else None
        if not fits:
            notes.append("Even the smallest panel layout the roof allows would produce more than the site uses; generation is capped at your use.")
        elif cfg is building.configs[-1] and ac < annual_kwh:
            notes.append("The roof is the limit: it cannot carry enough panels to cover all your electricity.")
    else:
        precision = "pvgis_estimate"
        if not pvgis_kwh_per_kwp:
            return SolarOption(available=False, notes=["No irradiance data for this location."])
        yield_per_kwp = pvgis_kwh_per_kwp
        if not roof_area_m2 or roof_area_m2 <= 0:
            return SolarOption(available=False, precision="pvgis_estimate", needs_roof_area=True, yield_kwh_per_kwp=yield_per_kwp,
                               notes=["Google has no roof imagery for this site. Tell us the roof area to get an estimate."])
        kwp_roof = roof_area_m2 * USABLE_ROOF_SHARE * KWP_PER_M2
        kwp_need = annual_kwh / yield_per_kwp
        kwp = min(kwp_roof, kwp_need)
        kwh = kwp * yield_per_kwp
        notes.append(f"Estimate from irradiance (PVGIS) and a roof area of {roof_area_m2:,.0f} m2; {USABLE_ROOF_SHARE:.0%} of the roof assumed usable.")

    out = SolarOption(
        available=True, precision=precision, kwp=round(kwp, 2), panels=panels, annual_kwh=round(kwh, 0),
        share_of_electricity=round(kwh / annual_kwh, 4),
        avoided_location_kg=round(kwh * grid_factor, 1) if grid_factor else 0.0,
        avoided_market_kg=round(kwh * (market_factor if market_factor is not None else (grid_factor or 0.0)), 1),
        roof_area_m2=round(area, 1) if area else None, yield_kwh_per_kwp=round(yield_per_kwp, 1) if yield_per_kwp else None,
        imagery_quality=quality, imagery_date=date_, notes=notes,
    )
    cost = solar_costs().get((country or "").upper())
    if cost:
        out.capex, out.currency = round(cost["per_kwp"] * kwp, 0), cost["currency"]
        out.capex_source = cost["source_name"]
        if tariff and tariff[1] == cost["currency"]:
            out.tariff, out.tariff_source = round(tariff[0], 4), tariff[2]
            out.annual_saving = round(kwh * tariff[0], 0)
            out.payback_years = round(out.capex / out.annual_saving, 1) if out.annual_saving else None
        else:
            out.notes.append("No price in the same currency as the installed-cost estimate, so no payback is shown.")
    else:
        out.notes.append("No installed-cost estimate for this country yet, so no payback is shown.")
    return out


# --- other levers --------------------------------------------------------------------------

def rank_levers(*, lines: list[InventoryLine], grid_factor: float | None) -> list[LeverResult]:
    s1_by = {}
    for l in lines:
        if l.scope == 1:
            s1_by[l.energy_type.value] = s1_by.get(l.energy_type.value, 0.0) + l.kg_co2e
    s2_loc = sum(l.kg_co2e for l in lines if l.scope == 2 and l.basis == "location")
    s2_mkt = sum(l.kg_co2e for l in lines if l.scope == 2 and l.basis == "market")
    lpg_units = sum(l.quantity for l in lines if l.scope == 1 and l.energy_type == EnergyType.LPG)

    out: list[LeverResult] = []
    for lv in levers():
        if lv.basis == "location":
            baseline = s2_loc
        elif lv.basis == "market":
            baseline = s2_mkt
        else:
            baseline = s1_by.get(lv.applies_to, 0.0)
        if baseline <= 0:
            continue
        if lv.kind == "switch":
            if grid_factor is None:          # cannot net the extra electricity, so cannot judge the switch
                continue
            # Burning the fuel goes away, but the same heat now needs electricity at the grid factor.
            extra = lpg_units * lv.electric_kwh_per_unit * (grid_factor or 0.0)
            net = baseline - extra
            lo = hi = net
            beneficial = net > 0
        else:
            lo, hi = baseline * lv.min_pct / 100, baseline * lv.max_pct / 100
            beneficial = True
        out.append(LeverResult(
            id=lv.id, name=lv.name, kind=lv.kind, basis=lv.basis, baseline_kg=round(baseline, 1),
            saved_min_kg=round(lo, 1), saved_max_kg=round(hi, 1), saved_mid_kg=round((lo + hi) / 2, 1), beneficial=beneficial,
            cost_class=lv.cost_class, cost_note=lv.cost_note, source_name=lv.source_name, source_url=lv.source_url, note=lv.note,
        ))
    out.sort(key=lambda r: (not r.beneficial, -r.saved_mid_kg))
    return out


# --- the whole thing -----------------------------------------------------------------------

def advise(
    *, inventory: list[InventoryLine], activity: list[ActivityLine], country: str | None, site_id: str | None, single_site: bool,
    building: Building | None, pvgis_kwh_per_kwp: float | None, roof_area_m2: float | None,
) -> Advice:
    lines = _site_filter(inventory, site_id, single_site)
    act = [a for a in activity if site_id is None or single_site or a.site_id == site_id]
    elec_loc = [l for l in lines if l.scope == 2 and l.basis == "location" and l.energy_type == EnergyType.ELECTRICITY]
    elec_mkt = [l for l in lines if l.scope == 2 and l.basis == "market" and l.energy_type == EnergyType.ELECTRICITY]
    kwh = sum(l.quantity for l in elec_loc)
    grid = sum(l.kg_co2e for l in elec_loc) / kwh if kwh else None
    mkt_kwh = sum(l.quantity for l in elec_mkt)
    mkt = sum(l.kg_co2e for l in elec_mkt) / mkt_kwh if mkt_kwh else None
    tariff = own_tariff(act, country) or fallback_tariff(country)
    return Advice(
        site_id=site_id, annual_electricity_kwh=round(kwh, 1),
        scope1_kg=round(sum(l.kg_co2e for l in lines if l.scope == 1), 1),
        scope2_location_kg=round(sum(l.kg_co2e for l in lines if l.scope == 2 and l.basis == "location"), 1),
        scope2_market_kg=round(sum(l.kg_co2e for l in lines if l.scope == 2 and l.basis == "market"), 1),
        grid_factor=round(grid, 4) if grid else None, market_factor=round(mkt, 4) if mkt else None,
        solar=size_solar(annual_kwh=kwh, grid_factor=grid, market_factor=mkt, country=country, building=building,
                         pvgis_kwh_per_kwp=pvgis_kwh_per_kwp, roof_area_m2=roof_area_m2, tariff=tariff),
        levers=rank_levers(lines=lines, grid_factor=grid),
    )
