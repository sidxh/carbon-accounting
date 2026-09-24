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
    assert "nearest available vintage" in c.explanation()


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
