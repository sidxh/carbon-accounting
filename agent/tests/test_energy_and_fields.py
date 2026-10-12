"""Energy in MWh with published calorific values, and the new questionnaire fields, checkable by hand."""

import csv
from pathlib import Path

import pytest

from app.energy import canonical_unit, convert_quantity, energy_totals, load_ncv, source_quantity
from app.facts import PreviousYear, compute_fact
from app.models import EnergyType, Unit

from .qhelpers import ctx, inv, profile, vn_lines

NCV_CSV = Path(__file__).resolve().parents[2] / "data" / "factors" / "ncv" / "ncv.csv"


def test_every_calorific_value_names_its_source():
    rows = list(csv.DictReader(NCV_CSV.open(encoding="utf-8")))
    assert {r["energy_type"] for r in rows} >= {"diesel", "petrol", "lpg", "natural_gas", "kerosene", "biomass"}
    for r in rows:
        assert r["source_name"].strip() and r["source_url"].startswith("https://") and r["vintage"].strip(), r["energy_type"]
        assert float(r["ncv_mj_per_kg"]) > 0


def test_energy_totals_by_hand():
    lines = [
        inv(EnergyType.ELECTRICITY, 3_600, Unit.KWH, 1, scope=2, basis="location"),       # 3.6 MWh
        inv(EnergyType.ELECTRICITY, 3_600, Unit.KWH, 1, scope=2, basis="market"),         # same kWh, must not count twice
        inv(EnergyType.DIESEL, 100, Unit.LITRE, 1, scope=1),                              # 100 L x 0.84 kg/L x 43 MJ/kg
        inv(EnergyType.LPG, 10_000, Unit.KG, 1, scope=1),                                 # 10,000 kg x 47.3 MJ/kg
        inv(EnergyType.NATURAL_GAS, 1_000, Unit.M3, 1, scope=1),                          # 1,000 m3 x 0.7 kg/m3 x 48 MJ/kg
        inv(EnergyType.REFRIGERANT, 3.5, Unit.KG, 1, scope=1),                            # not energy
    ]
    et = energy_totals(lines)
    assert et.by_type_mwh["electricity"] == pytest.approx(3.6)
    assert et.by_type_mwh["diesel"] == pytest.approx(100 * 0.84 * 43 / 3600)
    assert et.by_type_mwh["lpg"] == pytest.approx(10_000 * 47.3 / 3600)
    assert et.by_type_mwh["natural_gas"] == pytest.approx(1_000 * 0.7 * 48 / 3600)
    assert et.total_mwh == pytest.approx(sum(et.by_type_mwh.values()))
    assert et.complete and et.skipped == []
    assert any("Gas/Diesel oil" in c for c in et.citations)


def test_a_fuel_without_a_published_value_is_reported_not_guessed():
    et = energy_totals([inv(EnergyType.COAL, 5_000, Unit.KG, 1, scope=1)])
    assert not et.complete and et.total_mwh == 0 and "coal" in et.skipped[0]


def test_biomass_counts_as_renewable():
    et = energy_totals([inv(EnergyType.BIOMASS, 1_000, Unit.KG, 1, scope=1)])
    assert et.renewable_mwh == pytest.approx(1_000 * 15.6 / 3600) == et.total_mwh


def test_unit_aliases_and_conversions():
    assert [canonical_unit(x) for x in ("kWh", "MWh/year", "(L)", "リットル", "m³", "t-CO2", "t")] == ["kWh", "MWh", "L", "L", "m3", None, "t"]
    assert convert_quantity(2, "MWh", "kWh", EnergyType.ELECTRICITY) == 2_000
    assert convert_quantity(1, "L", "kWh", EnergyType.DIESEL) == pytest.approx(0.84 * 43 / 3.6)
    assert convert_quantity(1, "t", "kg", EnergyType.LPG) == 1_000
    assert convert_quantity(1_000, "L", "kL", EnergyType.DIESEL) == 1


def test_source_quantity_in_the_sheets_unit():
    lines = vn_lines()
    assert source_quantity(lines, EnergyType.ELECTRICITY, "kWh") == (600_000, "")
    assert source_quantity(lines, EnergyType.ELECTRICITY, "MWh")[0] == pytest.approx(600)
    assert source_quantity(lines, EnergyType.LPG, "t")[0] == pytest.approx(10)
    assert source_quantity(lines, EnergyType.DIESEL, "L") == (None, "none")


def test_total_energy_fact_converts_fuels_and_cites_them():
    f = compute_fact("total_energy_mwh", ctx())
    assert not f.flagged and f.value == round(600 + 10_000 * 47.3 / 3600, 1)
    assert "Liquefied Petroleum Gases (LPG): 47.3 MJ/kg" in f.source and "EFRAG" in f.source


def test_total_energy_is_flagged_when_a_fuel_cannot_be_converted():
    f = compute_fact("total_energy_mwh", ctx(vn_lines() + [inv(EnergyType.COAL, 100, Unit.KG, 1, scope=1)]))
    assert f.flagged and f.value is None and "coal" in f.reason


def test_energy_fact_follows_the_sheets_unit():
    assert compute_fact("electricity_mwh", ctx(), unit="kWh").value == 600_000
    assert compute_fact("electricity_mwh", ctx(), unit="MWh").value == 600.0
    assert compute_fact("electricity_mwh", ctx(), unit="GJ").value == 2160.0


def test_emissions_in_kilograms_when_the_sheet_says_so():
    assert compute_fact("scope2_location_tco2e", ctx(), unit="kg-CO2").value == round(600_000 * 0.6592, 1)
    assert compute_fact("scope2_location_tco2e", ctx(), unit="t-CO2").value == round(600_000 * 0.6592 / 1000, 2)


def test_energy_by_source_rows():
    assert compute_fact("energy_by_source", ctx(), unit="kWh", energy_type="electricity").value == 600_000
    f = compute_fact("energy_by_source", ctx(), unit="L", energy_type="diesel")
    assert f.flagged and "enter 0 if none" in f.reason          # a source with no bills is the supplier's to confirm
    mix = compute_fact("energy_by_source", ctx())
    assert "electricity" in mix.value and "lpg" in mix.value and "Total" in mix.value


def test_scope2_both_holds_both_methods():
    v = compute_fact("scope2_both", ctx()).value
    assert "location-based 395.52 tCO2e" in v and "market-based 408.00 tCO2e" in v


def test_renewable_electricity_is_never_assumed():
    f = compute_fact("renewable_electricity_mwh", ctx())
    assert f.flagged and f.value is None and "green tariff" in f.reason


def test_profile_fields_answer_when_set_and_flag_when_not():
    assert compute_fact("employees", ctx()).flagged
    p = profile(headcount=420, revenue=24_000_000_000, revenue_currency="VND", nace_code="C.13.20")
    c = ctx(profile=p)
    assert compute_fact("employees", c).value == 420
    assert compute_fact("turnover", c).value == 24_000_000_000
    assert compute_fact("sector_code", c).value == "C.13.20"
    per_million = (29_400 + 7_308 + 395_520) / 1000 / 24_000
    assert compute_fact("ghg_intensity_turnover", c).value == round(per_million, 3)
    assert compute_fact("ghg_intensity_turnover", ctx()).flagged


def test_year_on_year_needs_an_earlier_year():
    assert compute_fact("emissions_previous_year", ctx()).flagged
    prev = PreviousYear("2024-01-01 to 2024-12-31", scope1_kg=30_000, scope2_location_kg=390_000)   # 420 t
    f = compute_fact("emissions_previous_year", ctx(previous=prev))
    assert f.value.startswith("Increased.") and "432.2 tCO2e" in f.value and "+2.9%" in f.value
    same = PreviousYear("2024", scope1_kg=36_708, scope2_location_kg=395_520)
    assert compute_fact("emissions_previous_year", ctx(previous=same)).value.startswith("Remained the same overall.")


def test_previous_year_is_the_closest_earlier_period_with_an_inventory():
    from datetime import date

    from app.facts import previous_year_of
    from app.models import ReportingPeriod
    from app.repo import MemoryRepo

    from .qhelpers import snapshot

    repo = MemoryRepo()
    repo.put_period("s", ReportingPeriod(id="p23", label="2023", start=date(2023, 1, 1), end=date(2023, 12, 31)))
    repo.put_period("s", ReportingPeriod(id="p24", label="2024", start=date(2024, 1, 1), end=date(2024, 12, 31)))
    cur = ReportingPeriod(id="p25", label="2025", start=date(2025, 1, 1), end=date(2025, 12, 31))
    repo.put_period("s", cur)
    assert previous_year_of(repo, "s", cur) is None
    repo.replace_inventory("s", "p23", vn_lines(), snapshot(vn_lines()))
    prev = previous_year_of(repo, "s", cur)
    assert prev and prev.label == "2023-01-01 to 2023-12-31"        # 2024 has no inventory, so 2023 is the nearest
    assert load_ncv()[EnergyType.DIESEL].mj_per_kg == 43
