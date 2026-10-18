from pathlib import Path

import pytest

from app.factor_library import FactorLibrary, FactorNotFound
from app.models import EnergyType, Unit

FACTORS_DIR = Path(__file__).resolve().parents[2] / "data" / "factors"


@pytest.fixture(scope="module")
def lib() -> FactorLibrary:
    return FactorLibrary.from_dir(FACTORS_DIR)


def test_every_csv_row_validates_and_ids_are_unique(lib):
    assert len(lib.factors) > 30
    assert len(lib.by_id) == len(lib.factors)
    assert all(f.source_url.startswith("http") for f in lib.factors)


def test_no_two_rows_answer_the_same_lookup(lib):
    # Two rows with identical (country, region, year, type, method, unit, gas)
    # would make `select` pick one arbitrarily. Fail loudly instead.
    seen: dict[tuple, str] = {}
    for f in lib.factors:
        key = (f.country, f.region, f.year, f.energy_type, f.method, f.unit, (f.gas or "").upper())
        assert key not in seen, f"{f.id} duplicates {seen[key]}"
        seen[key] = f.id


def test_vietnam_grid_exact_year(lib):
    c = lib.select(energy_type=EnergyType.ELECTRICITY, year=2022, country="VN", unit=Unit.KWH)
    assert c.factor.id == "VN-grid-2022-loc"
    assert c.exact_year is True
    assert c.factor.value == pytest.approx(0.6766)


def test_nearest_vintage_prefers_most_recent_prior_year(lib):
    # No 2019 row: should not jump forward when an earlier row exists... but the
    # earliest VN row is 2021, so 2019 must take the earliest year after it.
    c = lib.select(energy_type=EnergyType.ELECTRICITY, year=2019, country="VN", unit=Unit.KWH)
    assert c.factor.year == 2021
    assert c.exact_year is False
    assert "nearest available vintage for 2019" in c.explanation()


def test_regional_factor_beats_national_when_site_region_known(lib):
    c = lib.select(
        energy_type=EnergyType.ELECTRICITY, year=2024, country="AU", region="AU-SA", unit=Unit.KWH
    )
    assert c.factor.id == "AU-SA-grid-2024-loc"
    assert c.exact_region is True


def test_unknown_region_falls_back_to_national_and_says_so(lib):
    c = lib.select(
        energy_type=EnergyType.ELECTRICITY, year=2024, country="AU", region="AU-NT", unit=Unit.KWH
    )
    assert c.factor.id == "AU-grid-2024-loc"
    assert c.exact_region is False
    assert "national factor used" in c.explanation()


def test_market_based_uses_residual_mix_where_published(lib):
    c = lib.select(
        energy_type=EnergyType.ELECTRICITY, year=2024, country="AU", unit=Unit.KWH, scope2_method="market"
    )
    assert c.factor.method == "residual_mix"
    assert c.fell_back_to == "residual_mix"


def test_market_based_falls_back_to_grid_average_and_discloses_it(lib):
    c = lib.select(
        energy_type=EnergyType.ELECTRICITY, year=2022, country="VN", unit=Unit.KWH, scope2_method="market"
    )
    assert c.factor.method == "location"
    assert c.fell_back_to == "location"
    assert "fell back to location" in c.explanation()


def test_fuel_prefers_national_then_generic(lib):
    jp = lib.select(energy_type=EnergyType.DIESEL, year=2024, country="JP", unit=Unit.LITRE)
    assert jp.factor.id == "JP-diesel-2024"
    vn = lib.select(energy_type=EnergyType.DIESEL, year=2024, country="VN", unit=Unit.LITRE)
    assert vn.factor.country == "GLOBAL"
    assert vn.factor.id == "GL-diesel-2024"


def test_refrigerant_requires_gas_and_matches_blend(lib):
    with pytest.raises(FactorNotFound):
        lib.select(energy_type=EnergyType.REFRIGERANT, year=2024, country="VN")
    c = lib.select(energy_type=EnergyType.REFRIGERANT, year=2024, country="VN", gas="r-410a")
    assert c.factor.gas == "R-410A"
    assert c.factor.value == 1924


def test_biogenic_factor_lookup(lib):
    f = lib.biogenic(EnergyType.BIOMASS, 2024, Unit.KG)
    assert f is not None and f.method == "biogenic"


def test_missing_factor_raises_not_silently_zero(lib):
    with pytest.raises(FactorNotFound):
        lib.select(energy_type=EnergyType.ELECTRICITY, year=2024, country="ZZ", unit=Unit.KWH)


def test_source_links_are_https_and_not_on_retired_hosts(lib):
    # Every factor is cited with a link a user can click. Plain http and hosts known to have
    # been retired (Japan's MOE moved to policies.env.go.jp) must not creep back in.
    retired = ("ghg-santeikohyo.env.go.jp",)
    for f in lib.factors:
        assert f.source_url.startswith("https://"), f"{f.id}: {f.source_url}"
        assert not any(h in f.source_url for h in retired), f"{f.id}: {f.source_url}"
        assert f.source_url == f.source_url.strip() and " " not in f.source_url


def test_stored_lines_are_pointed_at_the_current_source_link(lib):
    from app.repo import current_factor_links
    from tests.qhelpers import inv

    jp = lib.by_id["JP-lpg-2024"]
    old = "https://ghg-santeikohyo.env.go.jp/calc"
    stale = inv(EnergyType.LPG, 500, Unit.KG, 1500.0, scope=1).model_copy(update={
        "factor_id": jp.id, "factor_source_url": old, "factor_citation": f"{jp.source_name}; {old}",
    })
    unknown = inv(EnergyType.LPG, 1, Unit.KG, 3.0, scope=1)   # factor_id "f" is not in the library

    out = current_factor_links([stale, unknown])

    assert out[0].factor_source_url == jp.source_url and old not in out[0].factor_citation
    assert jp.source_url in out[0].factor_citation
    assert out[0].kg_co2e == 1500.0 and out[0].factor_value == stale.factor_value   # figures untouched
    assert out[1].factor_source_url == ""                                            # unknown ids are left alone
