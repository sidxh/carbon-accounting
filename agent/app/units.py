"""Unit conversion, deterministic and documented.

Densities and net calorific values are the ones the factor sources themselves
use, so a litre of LPG converted here and multiplied by a per-kg factor gives
the same answer the source's per-litre factor would.
"""

from __future__ import annotations

from .models import EnergyType, Unit

# kg per litre
DENSITY_KG_PER_L: dict[EnergyType, float] = {
    EnergyType.DIESEL: 0.84,
    EnergyType.PETROL: 0.74,
    EnergyType.LPG: 0.51,  # DEFRA: 1.96 L/kg
    EnergyType.KEROSENE: 0.80,
}

# GJ per unit (net calorific value), keyed by (energy_type, unit)
NCV_GJ: dict[tuple[EnergyType, Unit], float] = {
    (EnergyType.DIESEL, Unit.LITRE): 0.0386,  # 38.6 GJ/kL (NGA)
    (EnergyType.PETROL, Unit.LITRE): 0.0342,
    (EnergyType.KEROSENE, Unit.LITRE): 0.0370,
    (EnergyType.LPG, Unit.LITRE): 0.0257,  # 25.7 GJ/kL (NGA)
    (EnergyType.LPG, Unit.KG): 0.0461,  # 46.1 GJ/t
    (EnergyType.NATURAL_GAS, Unit.M3): 0.0393,  # 39.3 MJ/m3
    (EnergyType.COAL, Unit.KG): 0.027,
    (EnergyType.BIOMASS, Unit.KG): 0.0155,
}


class ConversionError(ValueError):
    pass


def convert(quantity: float, from_unit: Unit, to_unit: Unit, energy_type: EnergyType) -> float:
    """Convert `quantity` between units for a given energy carrier.

    Raises ConversionError when no defensible conversion exists (for example
    generator hours, which need a rated-consumption assumption recorded first).
    """
    if from_unit == to_unit:
        return quantity

    # Energy
    if (from_unit, to_unit) == (Unit.MWH, Unit.KWH):
        return quantity * 1000
    if (from_unit, to_unit) == (Unit.KWH, Unit.MWH):
        return quantity / 1000

    # Mass
    if (from_unit, to_unit) == (Unit.TONNE, Unit.KG):
        return quantity * 1000
    if (from_unit, to_unit) == (Unit.KG, Unit.TONNE):
        return quantity / 1000

    # Volume <-> mass via density
    if (from_unit, to_unit) == (Unit.LITRE, Unit.KG):
        d = DENSITY_KG_PER_L.get(energy_type)
        if d is None:
            raise ConversionError(f"no density for {energy_type}")
        return quantity * d
    if (from_unit, to_unit) == (Unit.KG, Unit.LITRE):
        d = DENSITY_KG_PER_L.get(energy_type)
        if d is None:
            raise ConversionError(f"no density for {energy_type}")
        return quantity / d
    if (from_unit, to_unit) == (Unit.TONNE, Unit.LITRE):
        return convert(quantity * 1000, Unit.KG, Unit.LITRE, energy_type)

    # Anything -> GJ via net calorific value
    if to_unit == Unit.GJ:
        ncv = NCV_GJ.get((energy_type, from_unit))
        if ncv is None:
            # try via an intermediate unit
            for mid in (Unit.KG, Unit.LITRE):
                if (energy_type, mid) in NCV_GJ:
                    try:
                        return convert(quantity, from_unit, mid, energy_type) * NCV_GJ[(energy_type, mid)]
                    except ConversionError:
                        continue
            raise ConversionError(f"no calorific value for {energy_type} in {from_unit}")
        return quantity * ncv
    if from_unit == Unit.GJ:
        ncv = NCV_GJ.get((energy_type, to_unit))
        if ncv is None:
            raise ConversionError(f"no calorific value for {energy_type} in {to_unit}")
        return quantity / ncv

    raise ConversionError(f"cannot convert {from_unit} to {to_unit} for {energy_type}")


# Units in which a factor may plausibly be expressed, in the order to try.
CANDIDATE_UNITS: dict[EnergyType, list[Unit]] = {
    EnergyType.ELECTRICITY: [Unit.KWH, Unit.MWH],
    EnergyType.PURCHASED_STEAM: [Unit.GJ, Unit.KWH],
    EnergyType.PURCHASED_COOLING: [Unit.KWH, Unit.GJ],
    EnergyType.DIESEL: [Unit.LITRE, Unit.KG, Unit.GJ],
    EnergyType.PETROL: [Unit.LITRE, Unit.KG, Unit.GJ],
    EnergyType.KEROSENE: [Unit.LITRE, Unit.GJ],
    EnergyType.LPG: [Unit.KG, Unit.LITRE, Unit.GJ],
    EnergyType.NATURAL_GAS: [Unit.M3, Unit.GJ],
    EnergyType.COAL: [Unit.KG, Unit.TONNE, Unit.GJ],
    EnergyType.BIOMASS: [Unit.KG, Unit.TONNE],
    EnergyType.REFRIGERANT: [Unit.KG],
    EnergyType.OTHER: [],
}
