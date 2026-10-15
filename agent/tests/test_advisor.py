"""The advisor's arithmetic, with every number checkable by hand. Offline."""

import json
from datetime import date
from pathlib import Path

import pytest

from app.advisor import advise, fallback_tariff, own_tariff, rank_levers, size_solar, solar_costs
from app.models import ActivityLine, EnergyType, InventoryLine, Unit
from app.solar import Building, RoofConfig

FIX = Path(__file__).parent / "fixtures"
D0, D1 = date(2025, 1, 1), date(2025, 12, 31)


def inv(et, qty, unit, kg, *, scope, basis=None, site="main", factor=None):
    return InventoryLine(id=f"{et}-{basis}-{scope}-{qty}", supplier_id="s", site_id=site, scope=scope, energy_type=et, quantity=qty, unit=unit,
                         factor_id="f", factor_value=factor or kg / qty, factor_citation="c", method="location", basis=basis, kg_co2e=kg,
                         tier="primary", source_doc_id="d", activity_line_id="a", period_start=D0, period_end=D1)


# A site using 600,000 kWh at 0.6592 kg/kWh (VN), market factor 0.68, with LPG and refrigerant.
VN = [
    inv(EnergyType.ELECTRICITY, 600_000, Unit.KWH, 600_000 * 0.6592, scope=2, basis="location"),
    inv(EnergyType.ELECTRICITY, 600_000, Unit.KWH, 600_000 * 0.68, scope=2, basis="market"),
    inv(EnergyType.LPG, 10_000, Unit.KG, 10_000 * 2.94, scope=1),
    inv(EnergyType.REFRIGERANT, 3.5, Unit.KG, 3.5 * 2088, scope=1),
]


def kariya() -> Building:
    d = json.loads((FIX / "solar_kariya.json").read_text())["solarPotential"]
    return Building(68, 133.0, 305.0, 400.0, 1.045 * 1.879, 1480.0, "HIGH", date(2023, 3, 29),
                    [RoofConfig(c["panelsCount"], c["yearlyEnergyDcKwh"]) for c in d["solarPanelConfigs"]])


def test_solar_api_picks_the_largest_layout_that_does_not_exceed_use():
    # Use 20,000 kWh: configs give AC 1,861 / 9,010 / 30,545 kWh, so the 20-panel one.
    s = size_solar(annual_kwh=20_000, grid_factor=0.5, market_factor=0.5, country="JP", building=kariya(), pvgis_kwh_per_kwp=1430,
                   roof_area_m2=None, tariff=(30.0, "JPY", "bills"))
    assert s.precision == "solar_api" and s.panels == 20 and s.kwp == 8.0
    assert s.annual_kwh == round(10_600 * 0.85) and s.share_of_electricity == pytest.approx(9010 / 20_000, abs=1e-3)
    assert s.avoided_location_kg == pytest.approx(9010 * 0.5, abs=1)
    assert s.imagery_quality == "HIGH" and s.imagery_date.year == 2023


def test_solar_carries_the_source_of_its_sunshine_data_for_both_precisions():
    api = size_solar(annual_kwh=20_000, grid_factor=0.5, market_factor=0.5, country="JP", building=kariya(), pvgis_kwh_per_kwp=1430,
                     roof_area_m2=None, tariff=None)
    assert "Google Solar API" in api.source_name and api.source_url.startswith("https://developers.google.com/maps/documentation/solar")
    est = size_solar(annual_kwh=600_000, grid_factor=0.6592, market_factor=0.68, country="VN", building=None, pvgis_kwh_per_kwp=1453,
                     roof_area_m2=1000, tariff=None)
    assert "PVGIS" in est.source_name and est.source_url.startswith("https://joint-research-centre.ec.europa.eu")
    ask = size_solar(annual_kwh=600_000, grid_factor=0.6592, market_factor=0.68, country="VN", building=None, pvgis_kwh_per_kwp=1453,
                     roof_area_m2=None, tariff=None)
    assert "PVGIS" in ask.source_name                                    # still says where the irradiance will come from
    assert size_solar(annual_kwh=0, grid_factor=None, market_factor=None, country="VN", building=None, pvgis_kwh_per_kwp=None,
                      roof_area_m2=None, tariff=None).source_url == ""


def test_advice_names_the_grid_factor_the_inventory_used():
    cited = [VN[0].model_copy(update={"factor_source_name": "EVN grid 2024", "factor_source_url": "https://example.org/evn"}), *VN[1:]]
    a = advise(inventory=cited, activity=[], country="VN", site_id="main", single_site=True, building=None, pvgis_kwh_per_kwp=1453, roof_area_m2=800)
    assert a.grid_factor_source_name == "EVN grid 2024" and a.grid_factor_source_url == "https://example.org/evn"


def test_roof_limited_site_uses_the_biggest_layout_and_says_so():
    s = size_solar(annual_kwh=500_000, grid_factor=0.5, market_factor=None, country="JP", building=kariya(), pvgis_kwh_per_kwp=None,
                   roof_area_m2=None, tariff=None)
    assert s.panels == 68 and s.share_of_electricity < 0.1 and any("roof is the limit" in n for n in s.notes)
    assert s.avoided_market_kg == s.avoided_location_kg                  # no market factor: same as location


def test_tiny_consumption_caps_generation_at_use():
    s = size_solar(annual_kwh=1_000, grid_factor=0.5, market_factor=0.5, country="JP", building=kariya(), pvgis_kwh_per_kwp=None,
                   roof_area_m2=None, tariff=None)
    assert s.annual_kwh == 1_000 and s.share_of_electricity == 1.0 and any("capped" in n for n in s.notes)


def test_fallback_asks_for_roof_area_then_sizes_from_irradiance():
    ask = size_solar(annual_kwh=600_000, grid_factor=0.6592, market_factor=0.68, country="VN", building=None, pvgis_kwh_per_kwp=1453,
                     roof_area_m2=None, tariff=None)
    assert not ask.available and ask.needs_roof_area and ask.precision == "pvgis_estimate"

    s = size_solar(annual_kwh=600_000, grid_factor=0.6592, market_factor=0.68, country="VN", building=None, pvgis_kwh_per_kwp=1453,
                   roof_area_m2=1000, tariff=(2280.0, "VND", "bills"))
    assert s.precision == "pvgis_estimate" and s.kwp == 120.0           # 1000 m2 x 0.6 x 0.2
    assert s.annual_kwh == round(120 * 1453)
    assert s.capex == 120 * solar_costs()["VN"]["per_kwp"] and s.currency == "VND"
    assert s.payback_years == pytest.approx(s.capex / (s.annual_kwh * 2280.0), abs=0.06)


def test_a_small_roof_is_not_oversized_and_a_big_roof_is_sized_to_use():
    big = size_solar(annual_kwh=60_000, grid_factor=0.6, market_factor=0.6, country="VN", building=None, pvgis_kwh_per_kwp=1500,
                     roof_area_m2=100_000, tariff=None)
    assert big.kwp == pytest.approx(60_000 / 1500) and big.share_of_electricity == pytest.approx(1.0, abs=0.01)


def test_no_payback_without_a_price_in_the_same_currency_or_a_cost():
    s = size_solar(annual_kwh=600_000, grid_factor=0.6, market_factor=0.6, country="VN", building=None, pvgis_kwh_per_kwp=1450,
                   roof_area_m2=1000, tariff=(0.3, "USD", "x"))
    assert s.capex and s.payback_years is None and any("payback" in n for n in s.notes)
    t = size_solar(annual_kwh=600_000, grid_factor=0.6, market_factor=0.6, country="ZZ", building=None, pvgis_kwh_per_kwp=1450,
                   roof_area_m2=1000, tariff=None)
    assert t.capex is None and any("installed-cost" in n for n in t.notes)


def test_own_tariff_uses_single_line_bills_in_one_currency_only():
    def al(i, doc, qty, amt, cur="đ"):
        return ActivityLine(id=i, supplier_id="s", source_doc_id=doc, energy_type=EnergyType.ELECTRICITY, quantity=qty, unit=Unit.KWH,
                            period_start=D0, period_end=D0, amount=amt, currency=cur)
    lines = [al("a", "d1", 1000, 2_000_000), al("b", "d2", 3000, 6_600_000),
             al("c", "d3", 100, 1), al("d", "d3", 100, 1)]                 # d3 has two lines: its amount is not a price
    price, cur, why = own_tariff(lines, "VN")
    assert cur == "VND" and price == pytest.approx(8_600_000 / 4000) and "2 electricity bills" in why
    assert own_tariff([al("e", "d9", 100, None)], "VN") is None


def test_fallback_tariff_is_the_middle_of_the_band():
    price, cur, _ = fallback_tariff("VN")
    assert cur == "VND" and price == (1200 + 4500) / 2
    assert fallback_tariff("ZZ") is None


def test_levers_are_ranked_and_only_appear_when_there_is_something_to_cut():
    r = rank_levers(lines=VN, grid_factor=0.6592)
    ids = [x.id for x in r]
    assert set(ids) == {"led", "compressed_air", "refrigerant_leaks", "lpg_to_electric", "rec"}
    by = {x.id: x for x in r}
    s2 = 600_000 * 0.6592
    assert by["led"].baseline_kg == pytest.approx(s2, abs=1) and by["led"].saved_min_kg == pytest.approx(s2 * 0.04, abs=1)
    assert by["rec"].basis == "market" and by["rec"].saved_max_kg == pytest.approx(600_000 * 0.68, abs=1)
    assert [x.saved_mid_kg for x in r if x.beneficial] == sorted([x.saved_mid_kg for x in r if x.beneficial], reverse=True)

    only_elec = rank_levers(lines=VN[:2], grid_factor=0.6592)
    assert {x.id for x in only_elec} == {"led", "compressed_air", "rec"}
    assert rank_levers(lines=[], grid_factor=None) == []


def test_lpg_to_electric_is_not_recommended_on_a_dirty_grid_and_is_on_a_clean_one():
    dirty = {x.id: x for x in rank_levers(lines=VN, grid_factor=0.6592)}["lpg_to_electric"]
    assert not dirty.beneficial and dirty.saved_mid_kg < 0              # 10,000 kg x 10.8 kWh x 0.66 > 29,400 kg
    clean = {x.id: x for x in rank_levers(lines=VN, grid_factor=0.05)}["lpg_to_electric"]
    assert clean.beneficial and clean.saved_mid_kg == pytest.approx(10_000 * 2.94 - 10_000 * 10.8 * 0.05, abs=1)
    order = [x.id for x in rank_levers(lines=VN, grid_factor=0.6592)]
    assert order[-1] == "lpg_to_electric"                                # not beneficial sinks to the bottom


def test_advise_reads_the_site_out_of_the_inventory():
    a = advise(inventory=VN, activity=[], country="VN", site_id="main", single_site=True, building=None, pvgis_kwh_per_kwp=1453, roof_area_m2=800)
    assert a.annual_electricity_kwh == 600_000 and a.grid_factor == pytest.approx(0.6592, abs=1e-4) and a.market_factor == pytest.approx(0.68, abs=1e-4)
    assert a.scope1_kg == pytest.approx(29_400 + 3.5 * 2088, abs=1)
    assert a.solar.kwp == 96.0 and a.levers

    other = advise(inventory=VN, activity=[], country="VN", site_id="annex", single_site=False, building=None, pvgis_kwh_per_kwp=1453, roof_area_m2=800)
    assert other.annual_electricity_kwh == 0 and not other.solar.available


def test_scenario_sums_the_ticked_options_and_caps_electricity_at_scope_2():
    from app.advisor import scenario

    a = advise(inventory=VN, activity=[], country="VN", site_id="main", single_site=True, building=None, pvgis_kwh_per_kwp=1453, roof_area_m2=800)
    s2, s1 = a.scope2_location_kg, a.scope1_kg
    by = {l.id: l for l in a.levers}

    none = scenario(a, set())
    assert none.base_kg == pytest.approx(s1 + s2, abs=0.2) and none.saved_kg == 0 and none.after_kg == none.base_kg

    solar_only = scenario(a, {"solar"})
    assert solar_only.saved_kg == pytest.approx(a.solar.avoided_location_kg, abs=0.2)

    # Electricity-side options add up, but never past Scope 2 itself.
    big = a.model_copy(update={"solar": a.solar.model_copy(update={"avoided_location_kg": s2})})
    assert scenario(big, {"solar", "led", "compressed_air"}).saved_kg == pytest.approx(s2, abs=0.2)

    # A Scope 1 option is not capped by Scope 2; a not-beneficial one and the market-only certificate add nothing.
    refr = scenario(a, {"refrigerant_leaks"})
    assert refr.saved_kg == pytest.approx(by["refrigerant_leaks"].saved_mid_kg, abs=0.2)
    assert scenario(a, {"lpg_to_electric"}).saved_kg == 0                 # worse on this grid, so skipped
    rec = scenario(a, {"rec"})
    assert rec.saved_kg == 0 and rec.rec_kg == pytest.approx(by["rec"].saved_mid_kg, abs=0.2)
