"""Fill the buyer's questionnaire from the inventory.

Division of labour, deliberately strict:

* Gemini reads the sheet and decides which inventory field each question is
  asking for. That is language understanding — a Japanese procurement team's
  Excel and CDP's numbered form ask the same things in different words.
* Code writes every number. Totals, intensities and energy figures come from
  the snapshot the calculator produced; the model never sees a chance to
  restate them.
* Text answers are templated from facts (methodology, sources, data quality,
  verification). Where the fact does not exist — a reduction target the
  supplier never stated, a customer share the buyer never gave — the cell is
  flagged and left for a human, not guessed.

Output is a copy of the buyer's own workbook with answers in place, cell
comments giving the source, and unanswerable cells highlighted.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Literal

from openpyxl import load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field

from ..gemini import get_gemini
from ..models import Assumption, InventoryLine, SupplierProfile
from ..repo import InventorySnapshot

Field_ = Literal[
    "company_name", "country", "reporting_period", "sites",
    "scope1_tco2e", "scope2_location_tco2e", "scope2_market_tco2e", "scope1_2_total_tco2e",
    "biogenic_tco2", "scope3", "methodology", "verification_status",
    "electricity_mwh", "fuel_consumption", "intensity_per_revenue", "allocation_to_customer",
    "reduction_target", "reduction_activities", "data_quality", "not_a_question",
]

FLAG_FILL = PatternFill("solid", fgColor="FFF2CC")   # yellow: left for a human
OK_FILL = PatternFill("solid", fgColor="E8F5E9")     # green: from documents / calculator
EDITED_FILL = PatternFill("solid", fgColor="DCEBFA") # blue: typed by the supplier

# Numbers the calculator produced. Typing over them in the questionnaire would
# break the document -> factor -> cell lineage, so the UI sends people to the
# inventory to correct the underlying quantity instead.
LOCKED_FIELDS = {
    "scope1_tco2e", "scope2_location_tco2e", "scope2_market_tco2e", "scope1_2_total_tco2e",
    "biogenic_tco2", "electricity_mwh",
}


@dataclass
class QuestionCell:
    id: str
    sheet: str
    row: int
    col: int
    text: str
    ref: str | None


class Mapping(BaseModel):
    question_id: str
    field: Field_
    reasoning: str = Field(description="One clause on why, e.g. 'asks for Scope 2 market-based'")


class MappingResult(BaseModel):
    mappings: list[Mapping]
    answer_column_offset: int = Field(
        default=1, description="How many columns to the right of the question the response cell sits (usually 1)"
    )


class Answer(BaseModel):
    question_id: str
    ref: str | None
    question: str
    field: str
    value: str | float | None
    source: str
    flagged: bool = False
    flag_reason: str | None = None
    # Where the question sits, so the workbook can be rewritten from stored answers.
    sheet: str = ""
    row: int = 0
    col: int = 0
    # False for calculator numbers; True for text, profile facts and anything flagged.
    editable: bool = True
    # True once the supplier has typed the value themselves.
    edited: bool = False


# --- 1. find the questions ---------------------------------------------------

def _looks_like_ref(v) -> bool:
    s = str(v).strip()
    return 0 < len(s) <= 10 and any(ch.isdigit() for ch in s)


def _harvest(wb) -> list[QuestionCell]:
    """Every cell that reads as a question: long text, a trailing '?', or any text
    with a reference number in the cell to its left."""
    cells: list[QuestionCell] = []
    n = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if not isinstance(v, str) or len(v.strip()) < 6:
                    continue
                left = ws.cell(row=cell.row, column=cell.column - 1).value if cell.column > 1 else None
                ref = str(left).strip() if left is not None and _looks_like_ref(left) else None
                text = v.strip()
                if ref or text.endswith("?") or len(text) > 25:
                    n += 1
                    cells.append(QuestionCell(f"q{n}", ws.title, cell.row, cell.column, text, ref))
    return cells


# --- 2. let the model map them -------------------------------------------------

MAP_SYSTEM = """You map questions from a buyer's supplier-emissions questionnaire onto a fixed set of
inventory fields. The questionnaire may be in any language and may follow CDP numbering (20.4 = Scope 1,
20.5 = Scope 2, 20.6 = methodology, 20.7 = Scope 3, 20.8 = verification, 20.12 = intensity/allocation,
20.15 = energy, 20.16 = target, 20.17 = reduction activities) or a company's own wording.
Use "not_a_question" for section headings, instructions, or titles. Use "scope2_location_tco2e" when the
question does not say which Scope 2 method it wants. Map each question to exactly one field."""


def _map_questions(cells: list[QuestionCell]) -> MappingResult:
    listing = "\n".join(f"{c.id} | ref={c.ref or '-'} | {c.text}" for c in cells)
    prompt = f"Questions (id | ref | text):\n{listing}\n\nReturn a mapping for every id."
    return get_gemini().generate_structured(prompt, MappingResult, system=MAP_SYSTEM)


# --- 3. answer from facts ----------------------------------------------------------

def _t(kg: float) -> float:
    return round(kg / 1000.0, 2)


def _fuel_summary(lines: list[InventoryLine]) -> str:
    agg: dict[tuple[str, str], float] = {}
    for l in lines:
        if l.scope == 1 and l.energy_type.value != "refrigerant":
            agg[(l.energy_type.value, l.unit.value)] = agg.get((l.energy_type.value, l.unit.value), 0) + l.quantity
    refr = {}
    for l in lines:
        if l.energy_type.value == "refrigerant":
            gas = l.factor_citation.split("—")[0]
            refr[l.factor_id] = refr.get(l.factor_id, 0) + l.quantity
    parts = [f"{k[0].replace('_', ' ')}: {v:,.0f} {k[1]}" for k, v in sorted(agg.items())]
    if refr:
        parts.append("refrigerant top-ups: " + ", ".join(f"{v:g} kg ({k.split('-')[-1]})" for k, v in refr.items()))
    return "; ".join(parts) if parts else "No fuel consumption recorded."


def _sources(lines: list[InventoryLine]) -> str:
    seen: dict[str, str] = {}
    for l in lines:
        seen.setdefault(l.factor_id, l.factor_citation.split(";")[0])
    return "\n".join(f"- {v}" for v in seen.values())


def _methodology(profile: SupplierProfile, snap: InventorySnapshot, lines: list[InventoryLine], asms: list[Assumption]) -> str:
    est_share = snap.totals.tier_mix.get("estimated", 0.0)
    text = (
        f"GHG Protocol Corporate Standard, operational control boundary, reporting period "
        f"{profile.fiscal_year_start:%d %b %Y} to {profile.fiscal_year_end:%d %b %Y}. "
        "Activity data taken from utility bills, fuel invoices and refrigerant service records; billing periods "
        "straddling the reporting year were apportioned by days. Scope 1 = fuel quantity × published fuel emission "
        "factor (all GHGs, CO2e), plus refrigerant top-ups × IPCC AR5 GWP-100. Scope 2 reported location-based "
        "(national or sub-national grid average) and market-based per the GHG Protocol Scope 2 Guidance hierarchy; "
        "where no residual-mix or contractual factor is published the market-based figure uses the grid average and "
        "this is disclosed. Emission factors (with vintages):\n"
        f"{_sources(lines)}\n"
        f"{len(asms)} assumption(s) recorded and documented in the methodology note; estimated data is "
        f"{est_share:.1%} of Scope 1+2. Biogenic CO2 reported separately."
    )
    return text


def answer_all(
    cells: list[QuestionCell],
    mapping: MappingResult,
    *,
    profile: SupplierProfile,
    snap: InventorySnapshot,
    lines: list[InventoryLine],
    assumptions: list[Assumption],
    customer_share: float | None = None,
) -> list[Answer]:
    t = snap.totals
    by_id = {c.id: c for c in cells}
    total_kg = t.scope1_kg + t.scope2_location_kg
    elec_kwh = sum(l.quantity for l in lines if l.scope == 2 and l.basis == "location" and l.energy_type.value == "electricity")
    out: list[Answer] = []

    for m in mapping.mappings:
        c = by_id.get(m.question_id)
        if c is None or m.field == "not_a_question":
            continue
        val: str | float | None = None
        src = ""
        flagged = False
        reason = None

        match m.field:
            case "company_name":
                val, src = profile.name or None, "supplier profile"
            case "country":
                val, src = profile.country, "supplier profile"
            case "reporting_period":
                val, src = f"{profile.fiscal_year_start:%Y-%m-%d} to {profile.fiscal_year_end:%Y-%m-%d}", "supplier profile"
            case "sites":
                val, src = ", ".join(s.name for s in profile.sites) or None, "supplier profile"
            case "scope1_tco2e":
                val, src = _t(t.scope1_kg), f"calculator: {sum(1 for l in lines if l.scope == 1)} Scope 1 lines"
            case "scope2_location_tco2e":
                val, src = _t(t.scope2_location_kg), "calculator: location-based grid factors"
            case "scope2_market_tco2e":
                val, src = _t(t.scope2_market_kg), "calculator: market-based per Scope 2 hierarchy"
            case "scope1_2_total_tco2e":
                val, src = _t(total_kg), "calculator: Scope 1 + Scope 2 (location-based)"
            case "biogenic_tco2":
                val, src = _t(t.biogenic_kg), "calculator: biogenic CO2 outside scopes"
            case "electricity_mwh":
                val, src = round(elec_kwh / 1000.0, 1), "sum of electricity activity lines"
            case "fuel_consumption":
                val, src = _fuel_summary(lines), "sum of Scope 1 activity lines"
            case "methodology":
                val, src = _methodology(profile, snap, lines, assumptions), "generated from calculator lineage"
            case "verification_status":
                val, src = "Not verified. Figures are self-reported from primary documents; an evidence pack (documents, factors, assumptions) is available for third-party assurance.", "stated"
            case "data_quality":
                mix = ", ".join(f"{k} {v:.1%}" for k, v in sorted(t.tier_mix.items()))
                val, src = f"By share of Scope 1+2 CO2e: {mix}. Primary = metered or invoiced quantity; estimated = documented assumption ({len(assumptions)} recorded).", "calculator tier mix"
            case "scope3":
                val, flagged, reason = "Not calculated. Scope 3 is out of scope for this response; Category 1 upstream data can be requested from our suppliers on request.", True, "Scope 3 not in this inventory"
                src = "stated"
            case "intensity_per_revenue":
                if profile.revenue and profile.revenue > 0:
                    per_million = (total_kg / 1000.0) / (profile.revenue / 1_000_000.0)
                    val, src = round(per_million, 3), f"Scope 1+2 ÷ revenue ({profile.revenue:,.0f} {profile.revenue_currency or ''})"
                else:
                    val, flagged, reason, src = None, True, "revenue not provided in supplier profile", "-"
            case "allocation_to_customer":
                if customer_share is not None:
                    val = f"{_t(total_kg * customer_share)} tCO2e — {customer_share:.1%} of Scope 1+2, allocated by share of revenue/output purchased"
                    src = "calculator × customer share"
                else:
                    val, flagged, reason, src = None, True, "customer's share of purchases not provided", "-"
            case "reduction_target" | "reduction_activities":
                val, flagged, reason, src = None, True, "to be stated by the supplier — not derivable from bills", "-"
            case _:
                val, flagged, reason = None, True, f"unmapped field {m.field}"

        # A locked number that could not be computed (e.g. intensity with no
        # revenue) is flagged, and a flagged cell is always the supplier's to fill.
        editable = flagged or m.field not in LOCKED_FIELDS
        out.append(Answer(question_id=c.id, ref=c.ref, question=c.text, field=m.field, value=val, source=src,
                          flagged=flagged, flag_reason=reason, sheet=c.sheet, row=c.row, col=c.col, editable=editable))
    return out


# --- 4. write back ------------------------------------------------------------------

def write_answers(template: bytes, answers: list[Answer], offset: int = 1) -> bytes:
    """Write answers into a copy of the buyer's workbook.

    Green = from documents and the calculator, blue = typed by the supplier,
    yellow = still open. Every written cell carries its source as a comment so
    a reviewer can tell which is which without our UI.
    """
    wb = load_workbook(io.BytesIO(template))
    offset = max(1, offset)
    for a in answers:
        if not a.sheet or not a.row or not a.col:
            continue
        ws = wb[a.sheet]
        target = ws.cell(row=a.row, column=a.col + offset)
        note = ws.cell(row=a.row, column=a.col + offset + 1)
        if a.flagged:
            target.value = f"NOT PROVIDED — {a.flag_reason}" if a.value is None else a.value
            target.fill = FLAG_FILL
            if note.value in (None, ""):
                note.value = a.flag_reason
        else:
            target.value = a.value
            target.fill = EDITED_FILL if a.edited else OK_FILL
        target.comment = Comment(f"Source: {a.source}", "supplier-carbon agent")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def fill_workbook(
    template: bytes,
    *,
    profile: SupplierProfile,
    snap: InventorySnapshot,
    lines: list[InventoryLine],
    assumptions: list[Assumption],
    customer_share: float | None = None,
) -> tuple[bytes, list[Answer], int]:
    """Returns the filled workbook, the answers, and the answer-column offset
    (kept on the record so the workbook can be rewritten after an edit)."""
    wb = load_workbook(io.BytesIO(template))
    cells = _harvest(wb)
    if not cells:
        raise ValueError("no questions found in the workbook")
    mapping = _map_questions(cells)
    answers = answer_all(cells, mapping, profile=profile, snap=snap, lines=lines, assumptions=assumptions,
                         customer_share=customer_share)
    offset = max(1, mapping.answer_column_offset)
    return write_answers(template, answers, offset), answers, offset
