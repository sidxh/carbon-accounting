"""Builders shared by the questionnaire tests: inventory lines, a snapshot and a profile, offline."""

from datetime import date

from app.facts import FactContext
from app.models import EnergyType, InventoryLine, InventoryTotals, SupplierProfile, Unit
from app.repo import InventorySnapshot

D0, D1 = date(2025, 1, 1), date(2025, 12, 31)


def inv(et, qty, unit, kg, *, scope, basis=None, site="main"):
    return InventoryLine(
        id=f"{et.value}-{basis}-{scope}-{qty}", supplier_id="s", site_id=site, scope=scope, energy_type=et, quantity=qty,
        unit=unit, factor_id="f", factor_value=kg / qty if qty else 0, factor_citation="c", method="location", basis=basis,
        kg_co2e=kg, tier="primary", source_doc_id="d", activity_line_id="a", period_start=D0, period_end=D1,
    )


def vn_lines():
    """600 MWh of grid electricity, 10 t of LPG and a refrigerant top-up."""
    return [
        inv(EnergyType.ELECTRICITY, 600_000, Unit.KWH, 600_000 * 0.6592, scope=2, basis="location"),
        inv(EnergyType.ELECTRICITY, 600_000, Unit.KWH, 600_000 * 0.68, scope=2, basis="market"),
        inv(EnergyType.LPG, 10_000, Unit.KG, 10_000 * 2.94, scope=1),
        inv(EnergyType.REFRIGERANT, 3.5, Unit.KG, 3.5 * 2088, scope=1),
    ]


def snapshot(lines) -> InventorySnapshot:
    s1 = sum(l.kg_co2e for l in lines if l.scope == 1)
    loc = sum(l.kg_co2e for l in lines if l.scope == 2 and l.basis == "location")
    mkt = sum(l.kg_co2e for l in lines if l.scope == 2 and l.basis == "market")
    return InventorySnapshot(
        supplier_id="s", reporting_year=2025,
        totals=InventoryTotals(scope1_kg=s1, scope2_location_kg=loc, scope2_market_kg=mkt, biogenic_kg=0, by_site={},
                               by_energy_type={}, tier_mix={"primary": 1.0}, line_count=len(lines)),
    )


def profile(**kw) -> SupplierProfile:
    base = {"id": "s", "name": "Hoa Sen Garments", "country": "VN", "fiscal_year_start": D0, "fiscal_year_end": D1}
    base.update(kw)
    return SupplierProfile(**base)


def ctx(lines=None, **kw) -> FactContext:
    lines = vn_lines() if lines is None else lines
    prof = kw.pop("profile", None) or profile()
    return FactContext(prof, snapshot(lines), lines, **kw)
