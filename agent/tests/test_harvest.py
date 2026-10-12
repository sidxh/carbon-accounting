"""Where each answer goes, for the shapes buyer sheets actually come in. Offline: no model involved."""

import io

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from app.agents.filler import (
    Answer,
    Mapping,
    MappingResult,
    answer_all,
    choose_option,
    write_answers,
)
from app.agents.harvest import harvest

from .qhelpers import ctx, vn_lines


def _wb(build):
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    build(ws, wb)
    return wb


def _save(wb) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _fill(wb, fields: dict[str, tuple]):
    """Harvest, map by question text to (field, energy_type), answer and write; return (cells, answers, sheet)."""
    cells = harvest(wb)
    maps = []
    for c in cells:
        f, et = fields.get(c.text, ("not_a_question", None))
        maps.append(Mapping(question_id=c.id, field=f, energy_type=et, reasoning="test"))
    c0 = ctx()
    answers = answer_all(cells, MappingResult(mappings=maps), profile=c0.profile, snap=c0.snap, lines=vn_lines(), assumptions=[])
    out = load_workbook(io.BytesIO(write_answers(_save(wb), answers)))
    return cells, answers, out.worksheets[0]


def test_classic_ref_question_response_notes():
    def b(ws, _):
        ws.append(["Ref", "Question", "Response", "Notes"])
        ws.append(["20.4", "Scope 1 emissions in tCO2e?", None, None])
    cells, _, ws = _fill(_wb(b), {"Scope 1 emissions in tCO2e?": ("scope1_tco2e", None)})
    assert [(c.answer_row, c.answer_col) for c in cells] == [(2, 3)]
    assert ws["C2"].value == 36.71


def test_unit_column_between_question_and_answer_converts_to_that_unit():
    def b(ws, _):
        ws.append(["Item", "Unit", "Answer"])
        ws.append(["Electricity purchased", "kWh", None])
        ws.append(["Electricity purchased again", "MWh", None])
        ws.append(["LPG used", "t", None])
    cells, answers, ws = _fill(_wb(b), {
        "Electricity purchased": ("energy_by_source", "electricity"),
        "Electricity purchased again": ("electricity_mwh", None),
        "LPG used": ("energy_by_source", "lpg"),
    })
    assert [c.unit for c in cells] == ["kWh", "MWh", "t"]
    assert [ws.cell(r, 3).value for r in (2, 3, 4)] == [600_000, 600.0, 10.0]


def test_short_row_labels_are_questions_when_a_header_names_the_answer_column():
    def b(ws, _):
        ws.append(["Energy source", "Quantity", "Unit"])
        ws.append(["Diesel", None, "L"])
        ws.append(["電力", None, "kWh"])
    cells, answers, ws = _fill(_wb(b), {"電力": ("energy_by_source", "electricity"), "Diesel": ("energy_by_source", "diesel")})
    assert [(c.text, c.answer_col, c.unit) for c in cells] == [("Diesel", 2, "L"), ("電力", 2, "kWh")]
    assert ws["B3"].value == 600_000
    d = next(a for a in answers if a.question == "Diesel")
    assert d.flagged and ws["B2"].value.startswith("NOT PROVIDED")       # no diesel in this inventory: the supplier decides


def test_merged_question_cell_puts_the_answer_right_of_the_merge():
    def b(ws, _):
        ws["A2"] = "What were your gross Scope 1 emissions?"
        ws.merge_cells("A2:C2")
    cells, _, ws = _fill(_wb(b), {"What were your gross Scope 1 emissions?": ("scope1_tco2e", None)})
    assert [(c.row, c.col, c.answer_row, c.answer_col) for c in cells] == [(2, 1, 2, 4)]
    assert ws["D2"].value == 36.71


def test_question_spanning_the_page_takes_its_answer_from_the_row_below():
    def b(ws, _):
        ws["A2"] = "Describe the methodology used to calculate your emissions."
        ws.merge_cells("A2:F2")
        ws.merge_cells("A3:F3")
    cells, _, ws = _fill(_wb(b), {"Describe the methodology used to calculate your emissions.": ("methodology", None)})
    assert [(c.layout, c.answer_row, c.answer_col) for c in cells] == [("below", 3, 1)]
    assert ws["A3"].value.startswith("GHG Protocol Corporate Standard")
    assert ws["A2"].value.startswith("Describe the methodology")           # the question itself is untouched


def test_a_cell_the_buyer_already_answered_is_left_alone():
    def b(ws, _):
        ws.append(["Ref", "Question", "Response"])
        ws.append(["1", "Name of your company in full?", "Acme Co"])
    assert harvest(_wb(b)) == []


def test_headings_and_the_reference_column_are_not_taken_for_questions():
    def b(ws, _):
        ws.append(["Ref", "Question", "Response"])
        ws.append([None, "Emissions", None])
        ws["B2"].font = Font(bold=True)
        ws["B2"].fill = PatternFill("solid", fgColor="EEEEEE")
        ws.append(["20.4", "What were your Scope 1 emissions in tCO2e?", None])
        ws.append([None, "Biogenic CO2 (t)", None])
    cells = harvest(_wb(b))
    assert [c.text for c in cells] == ["Emissions", "What were your Scope 1 emissions in tCO2e?", "Biogenic CO2 (t)"]
    assert cells[1].section == "Emissions" and cells[2].section == "Emissions"
    assert "20.4" not in [c.text for c in cells]


def test_table_row_carries_the_question_it_sits_under():
    def b(ws, _):
        ws.append(["Ref", "Question", "Response"])
        ws.append(["20.5", "What were your organization’s gross global Scope 2 emissions in metric tons CO2e?", "answer below"])
        ws.append([None, "Market-based emissions (metric tons CO2e)", None])
    cells = harvest(_wb(b))
    assert len(cells) == 1 and cells[0].parent.startswith("What were your organization")


def _dropdown_wb(options):
    def b(ws, _):
        ws.append(["Ref", "Question", "Response"])
        ws.append(["1", "Are your emissions verified by a third party?", None])
        ws.append(["2", "Which country are you based in?", None])
        ws["F1"], ws["F2"], ws["F3"] = options[0], options[1], options[2]
        dv = DataValidation(type="list", formula1="=$F$1:$F$3")
        ws.add_data_validation(dv)
        dv.add("C2")
        dv2 = DataValidation(type="list", formula1='"Japan,Vietnam,Thailand"')
        ws.add_data_validation(dv2)
        dv2.add("C3")
    return _wb(b)


def test_dropdown_cells_report_their_options_from_a_range_or_an_inline_list():
    cells = harvest(_dropdown_wb(["Verified", "Not verified", "In progress"]))
    assert cells[0].options == ["Verified", "Not verified", "In progress"]
    assert cells[1].options == ["Japan", "Vietnam", "Thailand"]


def test_dropdown_gets_the_matching_entry_and_the_statement_goes_to_notes():
    wb = _dropdown_wb(["Verified", "Not verified", "In progress"])
    wb.active["D1"] = "Notes"
    cells, answers, ws = _fill(wb, {"Are your emissions verified by a third party?": ("verification_status", None),
                                    "Which country are you based in?": ("country", None)})
    assert ws["C2"].value == "Not verified" and ws["D2"].value.startswith("Not verified. Figures are self-reported")
    assert ws["C3"].value == "Vietnam"                                  # VN is "Vietnam" in this sheet's list
    assert all(not a.flagged for a in answers)


def test_dropdown_with_no_defensible_entry_stays_empty_instead_of_taking_free_text():
    wb = _dropdown_wb(["Yes", "No, but planned", "No"])
    cells, answers, ws = _fill(wb, {"Are your emissions verified by a third party?": ("reduction_activities", None)})
    a = answers[0]
    assert a.flagged and ws["C2"].value is None and "choose from the sheet's list" in a.flag_reason
    assert ws["C2"].fill.fgColor.rgb.endswith("FFF2CC")


def test_choose_option_rules():
    assert choose_option("verification_status", "Not verified. Figures...", ["Verified", "Not verified"]) == "Not verified"
    assert choose_option("verification_status", "x", ["Third-party verified", "None"]) == "None"
    assert choose_option("scope3", "Not calculated", ["Yes", "No"]) == "No"
    assert choose_option("emissions_previous_year", "Decreased. Gross Scope 1+2", ["Increased", "Decreased"]) == "Decreased"
    assert choose_option("reduction_target", "x", ["Yes", "No"]) is None
    assert choose_option("verification_status", None, ["No"]) is None


def test_records_written_before_per_row_detection_still_rewrite():
    """An older stored answer has only the question's cell and the workbook-wide offset of 1."""
    def b(ws, _):
        ws.append(["Ref", "Question", "Response"])
        ws.append(["1", "Scope 1 emissions in tCO2e?", None])
    old = Answer(question_id="q1", ref="1", question="Scope 1", field="scope1_tco2e", value=12.5, source="calculator", sheet="Sheet1", row=2, col=2)
    out = load_workbook(io.BytesIO(write_answers(_save(_wb(b)), [old], 1))).worksheets[0]
    assert out["C2"].value == 12.5
