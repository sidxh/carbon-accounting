"""Energy in MWh, from the same inventory lines the emissions come from.

Questionnaires ask for energy as often as for emissions (VSME B3 wants total energy in MWh, Higg
wants energy by source, CDP wants electricity in MWh). Electricity is already in kWh on the bill.
Fuels are litres, kilograms or cubic metres, so they go through a net calorific value and, for
volumes, a density. Those values live in `data/factors/ncv/ncv.csv` with their source, so a
number a buyer sees can be traced to a published table, not to code.

A fuel with no published value there (coal is one: its heating value varies by a factor of
about 1.5 between grades) is reported as not convertible, and the answer that needs it is
flagged instead of guessed.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from functools import lru_cache

from .models import EnergyType, InventoryLine
from .settings import get_settings
from .units import ConversionError

# Canonical unit names used in questionnaires, and what one of each is worth.
_MJ_PER = {"MJ": 1.0, "kWh": 3.6, "MWh": 3600.0, "GJ": 1000.0, "TJ": 1_000_000.0}
_KG_PER = {"kg": 1.0, "t": 1000.0}
_L_PER = {"L": 1.0, "kL": 1000.0}

_UNIT_ALIASES = {
    "kwh": "kWh", "mwh": "MWh", "gj": "GJ", "mj": "MJ", "tj": "TJ",
    "kg": "kg", "t": "t", "ton": "t", "tons": "t", "tonne": "t", "tonnes": "t", "トン": "t",
    "l": "L", "lt": "L", "liter": "L", "litre": "L", "liters": "L", "litres": "L", "リットル": "L", "lít": "L",
    "kl": "kL", "キロリットル": "kL",
    "m3": "m3", "m³": "m3", "nm3": "m3", "㎥": "m3", "m^3": "m3",
}


def canonical_unit(text: str | None) -> str | None:
    """'kWh', 'MWh/year', '(L)', 'リットル' -> a canonical unit, or None when it is not one we convert."""
    if not text:
        return None
    t = text.strip().strip("()[]（）").strip()
    for sep in ("/", "／", " per ", " / "):
        if sep in t:
            t = t.split(sep)[0].strip()
    t = t.replace("·", "").replace(" ", "")
    return _UNIT_ALIASES.get(t.lower()) or _UNIT_ALIASES.get(t)


@dataclass(frozen=True)
class Ncv:
    energy_type: EnergyType
    fuel_name: str
    mj_per_kg: float
    kg_per_l: float | None
    kg_per_m3: float | None
    renewable: bool
    source_name: str
    source_url: str
    vintage: str

    def citation(self) -> str:
        dens = (f", {self.kg_per_l:g} kg/L" if self.kg_per_l else "") + (f", {self.kg_per_m3:g} kg/m3" if self.kg_per_m3 else "")
        return f"{self.fuel_name}: {self.mj_per_kg:g} MJ/kg{dens} ({self.source_name}, {self.vintage})"


@lru_cache
def load_ncv() -> dict[EnergyType, Ncv]:
    path = get_settings().resolve(get_settings().factors_dir) / "ncv" / "ncv.csv"
    out: dict[EnergyType, Ncv] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            t = EnergyType(row["energy_type"])
            out[t] = Ncv(
                t, row["fuel_name"], float(row["ncv_mj_per_kg"]),
                float(row["density_kg_per_l"]) if row["density_kg_per_l"] else None,
                float(row["density_kg_per_m3"]) if row["density_kg_per_m3"] else None,
                row["renewable"].strip().lower() == "true", row["source_name"], row["source_url"], row["vintage"],
            )
    return out


_CARRIERS = {EnergyType.ELECTRICITY, EnergyType.PURCHASED_STEAM, EnergyType.PURCHASED_COOLING}


def _kind(unit: str) -> str:
    if unit in _MJ_PER:
        return "energy"
    if unit in _KG_PER:
        return "mass"
    if unit == "m3":
        return "m3"
    return "volume"


def to_mj(quantity: float, unit: str, energy_type: EnergyType) -> float:
    """Energy content of `quantity` `unit` of this carrier, in MJ."""
    if unit in _MJ_PER:
        return quantity * _MJ_PER[unit]
    n = load_ncv().get(energy_type)
    if n is None:
        raise ConversionError(f"no published calorific value for {energy_type.value}")
    if unit in _KG_PER:
        return quantity * _KG_PER[unit] * n.mj_per_kg
    if unit in _L_PER:
        if not n.kg_per_l:
            raise ConversionError(f"no density per litre for {energy_type.value}")
        return quantity * _L_PER[unit] * n.kg_per_l * n.mj_per_kg
    if unit == "m3":
        if n.kg_per_m3:
            return quantity * n.kg_per_m3 * n.mj_per_kg
        if n.kg_per_l:      # a liquid billed by the cubic metre
            return quantity * 1000.0 * n.kg_per_l * n.mj_per_kg
        raise ConversionError(f"no density per m3 for {energy_type.value}")
    raise ConversionError(f"unknown unit {unit!r}")


def from_mj(mj: float, unit: str, energy_type: EnergyType) -> float:
    if unit in _MJ_PER:
        return mj / _MJ_PER[unit]
    one = to_mj(1.0, unit, energy_type)
    return mj / one


def convert_quantity(quantity: float, from_unit: str, to_unit: str, energy_type: EnergyType) -> float:
    """Convert between the units a buyer's sheet may ask for. Same dimension is exact; crossing
    dimensions (litres to MWh) goes through the calorific value and density."""
    if from_unit == to_unit:
        return quantity
    if _kind(from_unit) == _kind(to_unit) == "mass":
        return quantity * _KG_PER[from_unit] / _KG_PER[to_unit]
    if _kind(from_unit) == _kind(to_unit) == "volume":
        return quantity * _L_PER[from_unit] / _L_PER[to_unit]
    return from_mj(to_mj(quantity, from_unit, energy_type), to_unit, energy_type)


def mwh_in(value_mwh: float, unit: str) -> float | None:
    """MWh expressed in an energy unit (kWh, GJ, MJ ...), or None when `unit` is not an energy unit."""
    return value_mwh * 3600.0 / _MJ_PER[unit] if unit in _MJ_PER else None


def line_mwh(line: InventoryLine) -> tuple[float | None, str]:
    """(MWh, how) for one inventory line; MWh is None with the reason when it cannot be converted
    or the line is not energy (a refrigerant top-up)."""
    t = line.energy_type
    if t == EnergyType.REFRIGERANT:
        return None, "refrigerant is not energy"
    if t == EnergyType.OTHER:
        return None, "unclassified energy type"
    try:
        mj = to_mj(line.quantity, canonical_unit(line.unit.value) or line.unit.value, t)
    except ConversionError as e:
        return None, str(e)
    return mj / 3600.0, ""


def counted_lines(lines: list[InventoryLine]) -> list[InventoryLine]:
    """The lines whose energy counts once: every Scope 1 line, and Scope 2 on the location basis
    (the market-basis rows repeat the same kWh)."""
    return [l for l in lines if l.scope == 1 or (l.scope == 2 and l.basis in (None, "location"))]


@dataclass
class EnergyTotals:
    total_mwh: float = 0.0
    by_type_mwh: dict[str, float] = field(default_factory=dict)
    renewable_mwh: float = 0.0
    skipped: list[str] = field(default_factory=list)   # "coal: no published calorific value for coal"
    citations: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.skipped


def energy_totals(lines: list[InventoryLine]) -> EnergyTotals:
    out = EnergyTotals()
    cited: dict[EnergyType, str] = {}
    ncv = load_ncv()
    for l in counted_lines(lines):
        mwh, why = line_mwh(l)
        if mwh is None:
            if l.energy_type != EnergyType.REFRIGERANT:
                note = f"{l.energy_type.value.replace('_', ' ')}: {why}"
                if note not in out.skipped:
                    out.skipped.append(note)
            continue
        out.total_mwh += mwh
        out.by_type_mwh[l.energy_type.value] = out.by_type_mwh.get(l.energy_type.value, 0.0) + mwh
        n = ncv.get(l.energy_type)
        if n is not None:
            if n.renewable:
                out.renewable_mwh += mwh
            if l.energy_type not in _CARRIERS and l.unit.value not in ("kWh", "MWh", "GJ"):
                cited.setdefault(l.energy_type, n.citation())
    out.citations = list(cited.values())
    return out


def source_quantity(lines: list[InventoryLine], energy_type: EnergyType, unit: str | None) -> tuple[float | None, str]:
    """Quantity of one energy source over the period in `unit` (its native unit when None).
    Returns (None, reason) when the inventory has no such source or the unit cannot be reached."""
    mine = [l for l in counted_lines(lines) if l.energy_type == energy_type]
    if not mine:
        return None, "none"
    native = mine[0].unit.value
    native_c = canonical_unit(native) or native
    if any((canonical_unit(l.unit.value) or l.unit.value) != native_c for l in mine):
        total_mj = 0.0
        try:
            total_mj = sum(to_mj(l.quantity, canonical_unit(l.unit.value) or l.unit.value, energy_type) for l in mine)
        except ConversionError as e:
            return None, str(e)
        target = unit or "kWh"
        try:
            return from_mj(total_mj, target, energy_type), ""
        except ConversionError as e:
            return None, str(e)
    total = sum(l.quantity for l in mine)
    if unit is None or unit == native_c:
        return total, ""
    try:
        return convert_quantity(total, native_c, unit, energy_type), ""
    except ConversionError as e:
        return None, str(e)
