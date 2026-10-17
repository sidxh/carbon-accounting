"""Checks a bill can run on itself. Pure functions, no model, no network.

A misread digit or a swapped line is the commonest way a small supplier's
number goes wrong, and the cheapest to catch: the bill usually contains enough
to disprove itself. Each check returns a `LineCheck`, or None when the bill
does not carry what the check needs (silence is never a pass).

  index   meter readings and multiplier must reproduce the printed quantity
  price   amount / quantity must fall inside a cited plausibility band
  season  (see reconcile_tools) a month far from the carrier's own pattern
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .models import ActivityLine, EnergyType, LineCheck, MeterRegister
from .settings import get_settings

INDEX_REL_TOL = 0.005   # 0.5 % of the quantity
INDEX_ABS_TOL = 1.0     # or one unit, for small readings


def _fmt(x: float) -> str:
    return f"{x:,.0f}" if abs(x) >= 100 else f"{x:,.2f}".rstrip("0").rstrip(".")


# --- index arithmetic ----------------------------------------------------------------

def _index_parts(registers: list[MeterRegister]) -> list[float] | None:
    """Per-register consumption from the readings, or None when a reading cannot be trusted (rollover, misread)."""
    parts: list[float] = []
    for r in registers:
        if r.previous is None or r.current is None:
            continue
        if r.current < r.previous:
            return None
        parts.append((r.current - r.previous) * (r.multiplier or 1.0))
    return parts or None


def index_total(registers: list[MeterRegister]) -> float | None:
    """What the meter readings add up to: the figure to offer when the printed quantity disagrees with them."""
    parts = _index_parts(registers)
    return round(sum(parts), 2) if parts else None


def check_index(registers: list[MeterRegister], quantity: float, unit: str = "") -> LineCheck | None:
    """(current - previous) x multiplier, summed over registers, must equal the quantity."""
    parts = _index_parts(registers)
    if parts is None:       # nothing to compare, or a rollover / misread reading: undecidable here
        return None
    total = sum(parts)
    tol = max(INDEX_REL_TOL * abs(quantity), INDEX_ABS_TOL)
    u = f" {unit}" if unit else ""
    # The bill also prints each register's consumption. If those add up to the quantity
    # while the raw readings do not, two of the three reads agree and the odd one out is
    # a single digit of a meter reading, not the quantity the inventory will use.
    printed = [r.consumption for r in registers if r.previous is not None and r.current is not None]
    if abs(total - quantity) > tol and printed and all(c is not None for c in printed) and abs(sum(printed) - quantity) <= tol:
        return LineCheck(id="index", status="pass",
                         detail=f"the consumption printed per register adds up to {_fmt(quantity)}{u}; one meter reading may be misread but the quantity is consistent")
    if abs(total - quantity) <= tol:
        return LineCheck(id="index", status="pass",
                         detail=f"{len(parts)} meter register(s) give {_fmt(total)}{u}, matching the printed quantity")
    return LineCheck(id="index", status="fail",
                     detail=f"the meter readings give {_fmt(total)}{u} but the quantity read is {_fmt(quantity)}{u}")


# --- price plausibility -----------------------------------------------------------------

@dataclass(frozen=True)
class PriceBand:
    country: str
    energy_type: str
    currency: str
    unit: str
    low: float
    high: float
    source_name: str
    source_url: str
    note: str


@lru_cache(maxsize=1)
def _bands() -> tuple[PriceBand, ...]:
    d: Path = get_settings().price_bands_dir
    out: list[PriceBand] = []
    for f in sorted(d.glob("*.csv")) if d.exists() else []:
        with f.open(encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                out.append(PriceBand(
                    row["country"].strip().upper(), row["energy_type"].strip(), row["currency"].strip().upper(),
                    row["unit"].strip(), float(row["min"]), float(row["max"]),
                    row.get("source_name", ""), row.get("source_url", ""), row.get("note", ""),
                ))
    return tuple(out)


_CURRENCY = {"đ": "VND", "₫": "VND", "VNĐ": "VND", "VND": "VND", "DONG": "VND", "¥": "JPY", "￥": "JPY", "円": "JPY", "JPY": "JPY",
             "A$": "AUD", "AUD": "AUD"}


def normalise_currency(currency: str | None, country: str | None) -> str | None:
    """Bills print "đ", "¥" or "$"; bands are keyed by ISO code. A bare "$" is taken as the
    country's own dollar only where that is unambiguous (Australia)."""
    if not currency:
        return None
    c = currency.strip()
    if c.upper() in _CURRENCY or c in _CURRENCY:
        return _CURRENCY.get(c) or _CURRENCY[c.upper()]
    if c == "$" and (country or "").upper() == "AU":
        return "AUD"
    return c.upper() if len(c) == 3 else None


def band_for(country: str | None, energy_type: str, currency: str | None, unit: str) -> PriceBand | None:
    currency = normalise_currency(currency, country)
    if not country or not currency:
        return None
    for b in _bands():
        if b.country == country.upper() and b.energy_type == energy_type and b.currency == currency.upper() and b.unit == unit:
            return b
    return None


def check_price(amount: float | None, currency: str | None, quantity: float, unit: str, energy_type: str,
                country: str | None) -> LineCheck | None:
    """Amount per unit must sit inside the band. Only meaningful when the amount belongs to this one line."""
    if not amount or amount <= 0 or quantity <= 0:
        return None
    band = band_for(country, energy_type, currency, unit)
    if band is None:
        return None
    unit_price = amount / quantity
    rng = f"{_fmt(band.low)}–{_fmt(band.high)} {band.currency}/{unit}"
    if band.low <= unit_price <= band.high:
        return LineCheck(id="price", status="pass", detail=f"{_fmt(unit_price)} {band.currency}/{unit} is within the usual {rng}")
    return LineCheck(id="price", status="fail",
                     detail=f"{_fmt(unit_price)} {band.currency}/{unit} is outside the usual {rng} for {energy_type.replace('_', ' ')} in {band.country}")


# --- bookkeeping -----------------------------------------------------------------------

def with_check(line: ActivityLine, check: LineCheck | None) -> ActivityLine:
    """Return the line with `check` set, replacing any earlier check with the same id.

    A check the supplier already confirmed is never reopened by a re-run.
    """
    if check is None:
        return line
    current = next((c for c in line.checks if c.id == check.id), None)
    if current is not None and current.status == "confirmed":
        return line
    return line.model_copy(update={"checks": [c for c in line.checks if c.id != check.id] + [check]})


def failed(line: ActivityLine) -> list[LineCheck]:
    return [c for c in line.checks if c.status == "fail"]


def confirm_failed_checks(line: ActivityLine) -> ActivityLine:
    """The supplier looked at the bill: failed checks become `confirmed` and stop asking."""
    if not failed(line):
        return line
    return line.model_copy(update={"checks": [c.model_copy(update={"status": "confirmed"}) if c.status == "fail" else c for c in line.checks]})
