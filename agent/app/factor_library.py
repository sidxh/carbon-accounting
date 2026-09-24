"""The emission-factor library and the one function that chooses from it.

`select_factor` is the only route by which a coefficient reaches the
calculator. The agent decides *which category* of factor a line needs; this
code decides *which row*, following the GHG Protocol Scope 2 hierarchy and a
nearest-vintage rule, and returns the row with its citation so the choice can
be explained.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from .models import EnergyType, Factor, FactorMethod, Unit

# GHG Protocol Scope 2 Guidance, market-based hierarchy. Supplier-specific and
# residual-mix rows only exist where a supplier has provided them or a country
# publishes them; otherwise the market-based figure falls back to the grid
# average and that fall-back is disclosed on the line.
MARKET_HIERARCHY: tuple[FactorMethod, ...] = ("supplier_specific", "residual_mix", "location")


@dataclass(frozen=True)
class FactorChoice:
    factor: Factor
    exact_year: bool
    exact_region: bool
    fell_back_to: FactorMethod | None  # set when market-based had to use a grid average

    def explanation(self) -> str:
        parts = [self.factor.citation()]
        if not self.exact_year:
            parts.append(f"nearest available vintage used for {self.factor.year}")
        if not self.exact_region:
            parts.append("national factor used; no sub-national factor for this site")
        if self.fell_back_to:
            parts.append(f"market-based method fell back to {self.fell_back_to} per Scope 2 hierarchy")
        return "; ".join(parts)


class FactorNotFound(LookupError):
    pass


def _parse_row(row: dict[str, str]) -> Factor:
    return Factor(
        id=row["id"].strip(),
        country=row["country"].strip(),
        region=(row.get("region") or "").strip() or None,
        year=int(row["year"]),
        energy_type=EnergyType(row["energy_type"].strip()),
        method=row["method"].strip(),  # type: ignore[arg-type]
        value=float(row["value"]),
        unit=Unit(row["unit"].strip()),
        source_name=row["source_name"].strip(),
        source_url=row["source_url"].strip(),
        vintage=row["vintage"].strip(),
        gas=(row.get("gas") or "").strip() or None,
        notes=(row.get("notes") or "").strip(),
    )


class FactorLibrary:
    def __init__(self, factors: list[Factor]):
        self.factors = factors
        self.by_id = {f.id: f for f in factors}
        if len(self.by_id) != len(factors):
            dupes = [f.id for f in factors if sum(1 for g in factors if g.id == f.id) > 1]
            raise ValueError(f"duplicate factor ids: {sorted(set(dupes))}")

    @classmethod
    def from_dir(cls, directory: Path) -> "FactorLibrary":
        factors: list[Factor] = []
        for csv_path in sorted(directory.glob("*.csv")):
            with csv_path.open(newline="", encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    if not row.get("id"):
                        continue
                    factors.append(_parse_row(row))
        if not factors:
            raise FileNotFoundError(f"no factor CSVs found in {directory}")
        return cls(factors)

    # -- selection ---------------------------------------------------------

    def _candidates(
        self,
        energy_type: EnergyType,
        method: FactorMethod,
        unit: Unit | None,
        country: str,
        region: str | None,
        gas: str | None,
        allow_global: bool = True,
    ) -> list[Factor]:
        out = [
            f
            for f in self.factors
            if f.energy_type == energy_type
            and f.method == method
            and (unit is None or f.unit == unit)
            and (gas is None or (f.gas or "").upper() == gas.upper())
        ]
        regional = [f for f in out if f.country == country and region and f.region == region]
        if regional:
            return regional
        national = [f for f in out if f.country == country and f.region is None]
        if national:
            return national
        if not allow_global:
            return []
        return [f for f in out if f.country == "GLOBAL"]

    @staticmethod
    def _nearest_year(cands: list[Factor], year: int) -> Factor:
        # Prefer the same year; then the most recent year not after `year`;
        # then the earliest year after it. Never silently pick a stale row when
        # a closer one exists.
        exact = [f for f in cands if f.year == year]
        if exact:
            return exact[0]
        before = sorted((f for f in cands if f.year < year), key=lambda f: f.year, reverse=True)
        if before:
            return before[0]
        return sorted(cands, key=lambda f: f.year)[0]

    def select(
        self,
        *,
        energy_type: EnergyType,
        year: int,
        country: str,
        region: str | None = None,
        unit: Unit | None = None,
        scope2_method: str = "location",
        gas: str | None = None,
        allow_global: bool = True,
    ) -> FactorChoice:
        """Pick the factor for one activity line.

        `scope2_method` is "location" or "market" and only matters for
        electricity. Refrigerants need `gas`. `unit` narrows to a factor
        expressed in the line's unit; the caller converts units first.
        `allow_global=False` restricts to the country's own factors so a caller
        can prefer a national factor in another unit over a generic one in the
        line's unit.
        """
        if energy_type == EnergyType.REFRIGERANT:
            if not gas:
                raise FactorNotFound("refrigerant lines need the blend, e.g. R-410A")
            cands = self._candidates(energy_type, "gwp", Unit.KG, country, region, gas, allow_global)
            if not cands:
                raise FactorNotFound(f"no GWP for refrigerant {gas}")
            f = self._nearest_year(cands, year)
            return FactorChoice(f, f.year == year, True, None)

        if energy_type in (EnergyType.ELECTRICITY, EnergyType.PURCHASED_STEAM, EnergyType.PURCHASED_COOLING):
            if scope2_method == "market":
                for method in MARKET_HIERARCHY:
                    cands = self._candidates(energy_type, method, unit, country, region, None, allow_global)
                    if cands:
                        f = self._nearest_year(cands, year)
                        fell_back = method if method != "supplier_specific" else None
                        return FactorChoice(
                            f, f.year == year, bool(region) and f.region == region, fell_back
                        )
                raise FactorNotFound(f"no Scope 2 factor for {country} {year}")
            cands = self._candidates(energy_type, "location", unit, country, region, None, allow_global)
            if not cands:
                raise FactorNotFound(f"no location-based grid factor for {country} {year}")
            f = self._nearest_year(cands, year)
            return FactorChoice(f, f.year == year, (not region) or f.region == region, None)

        # Fuels: national factor first, then the DEFRA/IPCC generic fallback.
        cands = self._candidates(energy_type, "fuel", unit, country, region, None, allow_global)
        if not cands:
            raise FactorNotFound(f"no fuel factor for {energy_type} in {unit or 'any unit'}")
        f = self._nearest_year(cands, year)
        return FactorChoice(f, f.year == year, True, None)

    def biogenic(self, energy_type: EnergyType, year: int, unit: Unit) -> Factor | None:
        cands = [
            f for f in self.factors if f.energy_type == energy_type and f.method == "biogenic" and f.unit == unit
        ]
        return self._nearest_year(cands, year) if cands else None


_library: FactorLibrary | None = None


def get_library(directory: Path | None = None) -> FactorLibrary:
    global _library
    if _library is None or directory is not None:
        from .settings import get_settings

        _library = FactorLibrary.from_dir(directory or get_settings().factors_dir)
    return _library
