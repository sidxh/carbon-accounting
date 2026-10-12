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
import re
from collections.abc import Callable
from typing import Literal

from openpyxl import load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import PatternFill
from pydantic import BaseModel, Field

from ..advisor import Advice
from ..facts import (  # noqa: F401  (re-exported)
    FactContext,
    PreviousYear,
    _draft_reductions,
    compute_fact,
)
from ..gemini import get_gemini
from ..models import Assumption, InventoryLine, SupplierProfile
from ..repo import InventorySnapshot
from .harvest import QuestionCell, dropdown_options, harvest

Field_ = Literal[
    "company_name", "country", "reporting_period", "reporting_period_end", "sites",
    "scope1_tco2e", "scope2_location_tco2e", "scope2_market_tco2e", "scope2_both", "scope1_2_total_tco2e",
    "biogenic_tco2", "scope3", "methodology", "verification_status",
    "electricity_mwh", "renewable_electricity_mwh", "total_energy_mwh", "energy_by_source", "fuel_consumption",
    "intensity_per_revenue", "ghg_intensity_turnover", "allocation_to_customer", "emissions_previous_year",
    "employees", "turnover", "sector_code",
    "reduction_target", "reduction_activities", "data_quality", "not_a_question",
]

SourceType = Literal["electricity", "diesel", "petrol", "lpg", "natural_gas", "kerosene", "coal", "biomass",
                     "purchased_steam", "purchased_cooling"]

FLAG_FILL = PatternFill("solid", fgColor="FFF2CC")   # yellow: left for a human
OK_FILL = PatternFill("solid", fgColor="E8F5E9")     # green: from documents / calculator
EDITED_FILL = PatternFill("solid", fgColor="DCEBFA") # blue: typed by the supplier

# Numbers the calculator produced. Typing over them in the questionnaire would
# break the document -> factor -> cell lineage, so the UI sends people to the
# inventory to correct the underlying quantity instead.
LOCKED_FIELDS = {
    "scope1_tco2e", "scope2_location_tco2e", "scope2_market_tco2e", "scope2_both", "scope1_2_total_tco2e",
    "biogenic_tco2", "electricity_mwh", "total_energy_mwh", "emissions_previous_year",
}

EMISSION_FIELDS = {"scope1_tco2e", "scope2_location_tco2e", "scope2_market_tco2e", "scope1_2_total_tco2e", "biogenic_tco2"}
ENERGY_FIELDS = {"electricity_mwh", "total_energy_mwh", "renewable_electricity_mwh"}


class Mapping(BaseModel):
    question_id: str
    field: Field_
    energy_type: SourceType | None = Field(
        default=None,
        description="For energy_by_source rows that name one source (a row 'Diesel (L)' or 'Electricity'): which one",
    )
    reasoning: str = Field(description="One clause on why, e.g. 'asks for Scope 2 market-based'")


class MappingResult(BaseModel):
    mappings: list[Mapping]
    # Kept so records written before the harvester found each answer cell can still be rewritten.
    answer_column_offset: int = Field(default=1)


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
    # Where the answer goes. 0 on records written before the harvester located it per row.
    answer_row: int = 0
    answer_col: int = 0
    unit: str | None = None
    options: list[str] = Field(default_factory=list)
    # The full statement when the cell itself holds a dropdown choice; written in the notes column.
    note: str | None = None
    # False for calculator numbers; True for text, profile facts and anything flagged.
    editable: bool = True
    # True once the supplier has typed the value themselves.
    edited: bool = False


# --- 1. find the questions ---------------------------------------------------
# See harvest.py: where each answer goes is decided from the sheet, never by the model.

_harvest = harvest


# --- 2. let the model map them -------------------------------------------------

MAP_SYSTEM = """You map questions from a buyer's supplier-emissions questionnaire onto a fixed set of
inventory fields. The questionnaire may be in any language. It may follow CDP numbering (20.4 = Scope 1,
20.5 = Scope 2 with location- and market-based columns, 20.2 = methodology, 20.7 = Scope 3, 20.8 = verification,
20.9 = change on last year, 20.12 = allocation to the customer, 20.15.2 = electricity in MWh, 20.16 = target,
20.17 = reduction activities), the EU VSME form (B3), the Higg FEM, or a company's own wording.
Rules:
- "not_a_question" for section headings, instructions, titles, notes and table headers.
- "scope2_location_tco2e" when the question does not say which Scope 2 method it wants; "scope2_both" only when
  one cell must hold both the location-based and the market-based figure.
- "total_energy_mwh" for all energy (electricity plus fuels); "electricity_mwh" for electricity only;
  "renewable_electricity_mwh" for renewable electricity.
- A table row that names ONE energy source (a row "Diesel (L)", "電力", "Natural gas") is "energy_by_source" with
  energy_type set to that source. A question that asks for the energy mix as a whole is "energy_by_source" with
  energy_type null.
- "turnover" and "intensity_per_revenue" are different: turnover is the revenue figure itself, intensity is emissions per revenue.
- "employees" for the number of staff, "sector_code" for NACE or other industry codes.
- "emissions_previous_year" for any comparison with last year's emissions.
Map each question to exactly one field. Each line shows ref, the unit the sheet asks for, the section above it, and for a row that is one column of a
numbered table question the question it sits under."""


def _map_questions(cells: list[QuestionCell]) -> MappingResult:
    listing = "\n".join(
        f"{c.id} | ref={c.ref or '-'} | unit={c.unit or '-'} | section={c.section or '-'} | "
        + (f"(under: {c.parent}) " if c.parent else "") + c.text
        for c in cells
    )
    prompt = f"Questions (id | ref | unit | section | text):\n{listing}\n\nReturn a mapping for every id."
    return get_gemini().generate_structured(prompt, MappingResult, system=MAP_SYSTEM)


# --- 3. answer from facts ----------------------------------------------------------

_NEGATIVE = re.compile(r"(^|\b)(no|not|none|n/a|unverified|self)\b|未|無|なし|ない|không|chưa|khong|chua", re.IGNORECASE)
_COUNTRY_NAMES = {
    "VN": ("vietnam", "viet nam", "việt nam", "ベトナム"), "JP": ("japan", "日本"), "SG": ("singapore", "シンガポール"),
    "AU": ("australia", "オーストラリア"), "TH": ("thailand", "タイ"), "ID": ("indonesia", "インドネシア"), "IN": ("india", "インド"),
}


def choose_option(fld: str, value: str | float | None, options: list[str]) -> str | None:
    """The dropdown entry that says what `value` says, or None when none of them does.

    Only a few answers have a defensible reading as a choice: our verification and Scope 3 statements
    are both "no" by construction, and a country is a name in the list. Anything else is left for
    the supplier rather than forced into the closest-looking option."""
    if not options or value is None:
        return None
    text = str(value).strip().lower()
    for o in options:
        if o.strip().lower() == text:
            return o
    for o in options:
        if len(o) > 2 and text.startswith(o.strip().lower()):
            return o
    if fld in ("verification_status", "scope3"):
        neg = [o for o in options if _NEGATIVE.search(o)]
        return neg[0] if len(neg) == 1 or (neg and fld == "verification_status") else None
    if fld == "country":
        names = _COUNTRY_NAMES.get(str(value).upper(), ())
        for o in options:
            if o.strip().lower() in names:
                return o
    return None


def answer_all(
    cells: list[QuestionCell],
    mapping: MappingResult,
    *,
    profile: SupplierProfile,
    snap: InventorySnapshot,
    lines: list[InventoryLine],
    assumptions: list[Assumption],
    customer_share: float | None = None,
    advice: Advice | None = None,
    previous: PreviousYear | None = None,
    customer_name: str | None = None,
) -> list[Answer]:
    ctx = FactContext(profile, snap, lines, assumptions, customer_share, advice, previous, customer_name)
    by_id = {c.id: c for c in cells}
    out: list[Answer] = []

    for m in mapping.mappings:
        c = by_id.get(m.question_id)
        if c is None or m.field == "not_a_question":
            continue
        fact = compute_fact(m.field, ctx, unit=c.unit, energy_type=m.energy_type)
        val, src, flagged, reason = fact.value, fact.source, fact.flagged, fact.reason

        # An answer cell that is a dropdown takes one of its entries, or stays open.
        if c.options and isinstance(val, str):
            chosen = choose_option(m.field, val, c.options)
            if chosen:
                src = f"{src}; sheet choice “{chosen}” (full statement in the notes column)"
                note_text = val
                val = chosen
                reason = reason if flagged else None
                out.append(_answer(c, m, val, src, flagged, reason, ctx, note=note_text))
                continue
            val, flagged, reason = None, True, "choose from the sheet's list: " + ", ".join(c.options[:8])
        elif c.options and isinstance(val, (int, float)):
            pass
        out.append(_answer(c, m, val, src, flagged, reason, ctx))
    return out


def _answer(c: QuestionCell, m: Mapping, val, src, flagged, reason, ctx: FactContext, note: str | None = None) -> Answer:
    # A locked number that could not be computed (e.g. intensity with no revenue) is flagged,
    # and a flagged cell is always the supplier's to fill.
    editable = flagged or m.field not in LOCKED_FIELDS
    return Answer(
        question_id=c.id, ref=c.ref, question=c.text, field=m.field, value=val, source=src, flagged=flagged,
        flag_reason=reason, sheet=c.sheet, row=c.row, col=c.col, answer_row=c.answer_row, answer_col=c.answer_col,
        unit=c.unit, options=list(c.options), note=note, editable=editable,
    )


# --- 4. write back ------------------------------------------------------------------

def _anchor(ws, row: int, col: int) -> tuple[int, int]:
    for rng in ws.merged_cells.ranges:
        if rng.min_row <= row <= rng.max_row and rng.min_col <= col <= rng.max_col:
            return rng.min_row, rng.min_col
    return row, col


def write_answers(template: bytes, answers: list[Answer], offset: int = 1) -> bytes:
    """Write answers into a copy of the buyer's workbook.

    Green = from documents and the calculator, blue = typed by the supplier,
    yellow = still open. Every written cell carries its source as a comment so
    a reviewer can tell which is which without our UI.

    The cell is the one the harvester found for that question. A record made before that stored
    only the question's position and a single workbook-wide offset, which is used when no answer
    cell was stored. A dropdown cell is never filled with free text: it takes one of its entries or
    stays empty and yellow with the reason in the comment.
    """
    wb = load_workbook(io.BytesIO(template))
    offset = max(1, offset)
    for a in answers:
        if not a.sheet or not a.row or not a.col:
            continue
        ws = wb[a.sheet]
        tr, tc = (a.answer_row, a.answer_col) if a.answer_row and a.answer_col else (a.row, a.col + offset)
        tr, tc = _anchor(ws, tr, tc)
        target = ws.cell(row=tr, column=tc)
        options = dropdown_options(ws, wb, target.coordinate)
        note = None
        if not (a.answer_row and a.answer_col and a.row != tr):    # a "below" answer has no notes cell
            nr, nc = _anchor(ws, tr, tc + 1)
            cand = ws.cell(row=nr, column=nc)
            if (nr, nc) != (tr, tc) and cand.value in (None, ""):
                note = cand
        text_value = a.value
        if options and isinstance(text_value, str):
            chosen = choose_option(a.field, text_value, options) if text_value not in options else text_value
            if chosen is None:
                a_reason = f"choose from the list: {', '.join(options[:8])}"
                target.value = None
                target.fill = FLAG_FILL
                target.comment = Comment(f"{a_reason}. Answer drafted: {text_value}", "supplier-carbon agent")
                if note is not None:
                    note.value = a_reason
                continue
            text_value = chosen
        if a.flagged:
            empty = bool(options) or a.value is None
            target.value = None if options else (f"NOT PROVIDED — {a.flag_reason}" if a.value is None else a.value)
            target.fill = FLAG_FILL
            if note is not None and a.flag_reason:
                note.value = a.flag_reason
            if empty and options:
                target.comment = Comment(f"Open: {a.flag_reason}", "supplier-carbon agent")
                continue
        else:
            target.value = text_value
            target.fill = EDITED_FILL if a.edited else OK_FILL
            if a.note and note is not None:
                note.value = a.note
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
    advice: Advice | None = None,
    previous: PreviousYear | None = None,
    customer_name: str | None = None,
    mapper: Callable[[list[QuestionCell]], MappingResult] | None = None,
) -> tuple[bytes, list[Answer], int]:
    """Returns the filled workbook, the answers, and the legacy answer-column offset (kept on the
    record for the same reason `write_answers` still takes it). `mapper` replaces the model that maps
    wording to fields, for offline evaluation."""
    wb = load_workbook(io.BytesIO(template))
    cells = harvest(wb)
    if not cells:
        raise ValueError("no questions found in the workbook")
    mapping = (mapper or _map_questions)(cells)
    answers = answer_all(cells, mapping, profile=profile, snap=snap, lines=lines, assumptions=assumptions,
                         customer_share=customer_share, advice=advice, previous=previous, customer_name=customer_name)
    return write_answers(template, answers, 1), answers, 1
