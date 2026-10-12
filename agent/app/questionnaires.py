"""Official question banks, loaded from `data/questionnaires/*.yaml`.

A bank is the list of questions a framework really asks, with the number and the
wording the publisher prints, the field in our own data that answers it, and a
source URL with a version. The filler, the answer packs and the VSME writer all
read from here, so a number or a wording lives in exactly one place.

Nothing in a bank is invented. `wording` says how faithful each text is:

- `verbatim`: copied from the publisher's document
- `metric_name`: the metric's name as the publisher prints it (EcoVadis)
- `topic`: our description of a datapoint the publisher does not word publicly
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

from .settings import get_settings

Wording = Literal["verbatim", "metric_name", "topic"]
Delivery = Literal["portal", "excel"]
Evidence = Literal["bills", "calc", "method", "none"]

# Facts that only the answer packs derive (a split of another number, or a label for a
# column). They are not mapped by the filler's model.
PACK_FACTS = frozenset({
    "reporting_period_end", "currency", "energy_tracking", "customer_name", "allocation_scope",
    "allocation_level", "allocation_tco2e", "nonrenewable_electricity_mwh",
})


class Column(BaseModel):
    label: str
    field: str | None = None
    unit: str | None = None


class BankQuestion(BaseModel):
    ref: str
    text: str
    field: str | None = Field(description="our field that answers it; null when only the supplier can")
    wording: Wording = "verbatim"
    format: str = "text"
    unit: str | None = None
    evidence: list[Evidence] = Field(default_factory=lambda: ["none"])
    columns: list[Column] = Field(default_factory=list)
    ref_id: str | None = None
    named_range: str | None = None
    options: list[str] = Field(default_factory=list, description="the portal's own answer list, where the publisher prints it")
    options_note: str | None = None
    note: str | None = None


class Source(BaseModel):
    title: str
    url: str


class Bank(BaseModel):
    id: str
    name: str
    publisher: str
    delivery: Delivery
    version: str
    wording: Wording
    sources: list[Source]
    notes: list[str] = Field(default_factory=list)
    template_file: str | None = None
    questions: list[BankQuestion]

    def question(self, ref: str) -> BankQuestion | None:
        return next((q for q in self.questions if q.ref == ref), None)

    @property
    def refs(self) -> list[str]:
        return [q.ref for q in self.questions]


def banks_dir() -> Path:
    return get_settings().resolve(get_settings().questionnaires_dir)


def templates_dir() -> Path:
    return get_settings().resolve(get_settings().templates_dir)


def _read(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@lru_cache
def all_banks() -> dict[str, Bank]:
    banks: dict[str, Bank] = {}
    for path in sorted(banks_dir().glob("*.yaml")):
        raw = _read(path)
        for q in raw.get("questions", []):
            q.setdefault("wording", raw.get("wording", "verbatim"))
        bank = Bank.model_validate(raw)
        banks[bank.id] = bank
    return banks


def get_bank(bank_id: str) -> Bank:
    try:
        return all_banks()[bank_id]
    except KeyError as e:
        raise KeyError(f"unknown question bank {bank_id!r}") from e
