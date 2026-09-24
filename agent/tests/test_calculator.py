"""Known-answer tests. Every expected value is hand-computed from a factor in
data/factors so a regression in either the library or the arithmetic shows up.
"""

from datetime import date
from pathlib import Path

import pytest

from app.calculator import compute
from app.factor_library import FactorLibrary
from app.models import ActivityLine, EnergyType, Unit
from app.units import ConversionError, convert

FACTORS_DIR = Path(__file__).resolve().parents[2] / "data" / "factors"
FY = dict(period_start=date(2025, 1, 1), period_end=date(2025, 1, 31))


@pytest.fixture(scope="module")
def lib():
    return FactorLibrary.from_dir(FACTORS_DIR)


def line(id_, et, qty, unit, *, site="s1", tier="primary", gas=None, doc="d1"):
    return ActivityLine(
        id=id_, supplier_id="sup", source_doc_id=doc, site_id=site,
        energy_type=et, quantity=qty, unit=unit, gas=gas, tier=tier, **FY,
    )


# -- units ---------------------------------------------------------------

def test_unit_conversions():
    assert convert(2, Unit.MWH, Unit.KWH, EnergyType.ELECTRICITY) == 2000
    assert convert(200, Unit.LITRE, Unit.KG, EnergyType.LPG) == pytest.approx(102)
    assert convert(1000, Unit.LITRE, Unit.GJ, EnergyType.DIESEL) == pytest.approx(38.6)
    assert convert(1, Unit.TONNE, Unit.KG, EnergyType.COAL) == 1000
    with pytest.raises(ConversionError):
        convert(10, Unit.HOUR, Unit.LITRE, EnergyType.DIESEL)


# -- scope 2 ---------------------------------------------------------------

def test_electricity_vietnam_2022_location_and_market_fallback(lib):
    r = compute([line("e1", EnergyType.ELECTRICITY, 10_000, Unit.KWH)], lib, reporting_year=2022, country="VN")
    assert not r.skipped
    loc = next(l for l in r.lines if l.basis == "location")
    mkt = next(l for l in r.lines if l.basis == "market")
    assert loc.kg_co2e == pytest.approx(10_000 * 0.6766)  # 6,766 kg
    assert loc.factor_id == "VN-grid-2022-loc"
    # Vietnam publishes no residual mix, so the market figure falls back to the
    # grid average and the row says so.
    assert mkt.method == "location" and "fell back to location" in mkt.factor_citation
    assert r.totals.scope2_location_kg == pytest.approx(6766)
    assert r.totals.scope2_market_kg == pytest.approx(6766)
    assert r.totals.scope1_kg == 0


def test_electricity_in_mwh_is_converted(lib):
    r = compute([line("e2", EnergyType.ELECTRICITY, 2, Unit.MWH)], lib, reporting_year=2022, country="SG")
    loc = next(l for l in r.lines if l.basis == "location")
    assert loc.unit == Unit.KWH and loc.quantity == 2000
    assert loc.kg_co2e == pytest.approx(2000 * 0.4168)  # 833.6 kg


def test_australia_market_uses_residual_mix_and_state_for_location(lib):
    r = compute(
        [line("e3", EnergyType.ELECTRICITY, 1000, Unit.KWH, site="adelaide")],
        lib, reporting_year=2024, country="AU", region_by_site={"adelaide": "AU-SA"},
    )
    loc = next(l for l in r.lines if l.basis == "location")
    mkt = next(l for l in r.lines if l.basis == "market")
    assert loc.factor_id == "AU-SA-grid-2024-loc" and loc.kg_co2e == pytest.approx(230)
    assert mkt.method == "residual_mix" and mkt.kg_co2e == pytest.approx(680)


# -- scope 1 ---------------------------------------------------------------

def test_diesel_uses_generic_factor_where_country_has_none(lib):
    r = compute([line("f1", EnergyType.DIESEL, 1000, Unit.LITRE)], lib, reporting_year=2025, country="VN")
    (l,) = r.lines
    assert l.scope == 1 and l.factor_id == "GL-diesel-2024"
    assert l.kg_co2e == pytest.approx(2660)
    assert "nearest available vintage for 2025" in l.factor_citation


def test_lpg_in_litres_converted_to_kg_for_japanese_factor(lib):
    r = compute([line("f2", EnergyType.LPG, 200, Unit.LITRE)], lib, reporting_year=2024, country="JP")
    (l,) = r.lines
    # JP publishes per kg only; 200 L × 0.51 kg/L = 102 kg × 3.00 = 306 kg
    assert l.unit == Unit.KG and l.quantity == pytest.approx(102)
    assert l.factor_id == "JP-lpg-2024" and l.kg_co2e == pytest.approx(306)


def test_refrigerant_top_up_uses_gwp(lib):
    r = compute([line("r1", EnergyType.REFRIGERANT, 5, Unit.KG, gas="R-410A")], lib, reporting_year=2025, country="VN")
    (l,) = r.lines
    assert l.kg_co2e == pytest.approx(5 * 1924)  # 9,620 kg
    assert l.scope == 1


def test_biomass_reports_fossil_in_scope1_and_biogenic_separately(lib):
    r = compute([line("b1", EnergyType.BIOMASS, 2000, Unit.KG)], lib, reporting_year=2024, country="VN")
    (l,) = r.lines
    assert l.kg_co2e == pytest.approx(2000 * 0.016)  # 32 kg CH4+N2O in scope 1
    assert l.biogenic_kg_co2 == pytest.approx(2000 * 1.61)  # 3,220 kg outside scopes
    assert r.totals.biogenic_kg == pytest.approx(3220)
    assert r.totals.scope1_kg == pytest.approx(32)


# -- lineage, tiers, sites, skips ------------------------------------------

def test_lineage_and_tier_mix_and_site_totals(lib):
    lines = [
        line("e", EnergyType.ELECTRICITY, 10_000, Unit.KWH, site="A", tier="primary", doc="bill-1"),
        line("d", EnergyType.DIESEL, 1000, Unit.LITRE, site="A", tier="estimated", doc="assump-1"),
        line("g", EnergyType.LPG, 100, Unit.KG, site="B", tier="primary", doc="inv-2"),
    ]
    lines[1].assumption_ids = ["asm-q3"]
    r = compute(lines, lib, reporting_year=2022, country="VN")

    # Every line names its document, factor and assumptions.
    for l in r.lines:
        assert l.source_doc_id and l.factor_id and l.factor_citation
    d = next(l for l in r.lines if l.activity_line_id == "d")
    assert d.assumption_ids == ["asm-q3"] and d.tier == "estimated"

    t = r.totals
    assert t.by_site["A"]["scope2_location"] == pytest.approx(6766)
    assert t.by_site["A"]["scope1"] == pytest.approx(2660)
    assert t.by_site["B"]["scope1"] == pytest.approx(100 * 2.94)
    # Tier mix over headline (scope1 + scope2 location), sums to 1.
    assert sum(t.tier_mix.values()) == pytest.approx(1.0)
    assert t.tier_mix["estimated"] == pytest.approx(2660 / (6766 + 2660 + 294))


def test_generator_hours_are_skipped_not_guessed(lib):
    r = compute([line("h1", EnergyType.DIESEL, 40, Unit.HOUR)], lib, reporting_year=2025, country="VN")
    assert r.lines == []
    assert r.skipped and "rated-consumption" in r.skipped[0][1]


def test_unknown_country_skips_with_reason_rather_than_zero(lib):
    r = compute([line("e9", EnergyType.ELECTRICITY, 100, Unit.KWH)], lib, reporting_year=2024, country="ZZ")
    assert r.lines == [] and r.skipped[0][0] == "e9"
