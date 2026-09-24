"""Build a buyer questionnaire in the shape of the CDP SME climate module.

    .venv/bin/python -m scripts.make_cdp_template

Writes data/templates/cdp_sme_questionnaire.xlsx: question numbers and
wording follow the 2026 SME questionnaire's climate data points (20.x), laid
out the way procurement teams actually send them — one question per row, an
empty answer cell beside it.
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "templates" / "cdp_sme_questionnaire.xlsx"

QUESTIONS = [
    ("", "Supplier information", None),
    ("0.1", "Organisation name", "text"),
    ("0.2", "Country of headquarters", "text"),
    ("0.3", "Reporting period (start and end dates)", "text"),
    ("0.4", "Sites included in this response", "text"),
    ("", "Emissions", None),
    ("20.4", "What were your organisation's gross global Scope 1 emissions in metric tons CO2e?", "number"),
    ("20.5a", "What were your organisation's gross global Scope 2 emissions (location-based) in metric tons CO2e?", "number"),
    ("20.5b", "What were your organisation's gross global Scope 2 emissions (market-based) in metric tons CO2e?", "number"),
    ("20.6", "Describe the methodology, standards and emission factors used to calculate Scope 1 and 2", "text"),
    ("20.7", "If available, provide your Scope 3 emissions in metric tons CO2e and the categories covered", "text"),
    ("20.8", "Are your Scope 1 and 2 emissions verified by a third party? State the standard and assurance level", "text"),
    ("", "Energy", None),
    ("20.15.2", "Total electricity consumed in the reporting year (MWh)", "number"),
    ("20.15.3", "Total fuel consumed in the reporting year, by fuel type and unit", "text"),
    ("", "Intensity and allocation", None),
    ("20.12a", "Scope 1+2 emissions intensity per unit of revenue (tCO2e per million, state currency)", "number"),
    ("20.12b", "Emissions allocated to the requesting customer (tCO2e) and the allocation method used", "text"),
    ("", "Targets and actions", None),
    ("20.16", "Do you have an emissions reduction target? Describe it", "text"),
    ("20.17", "Describe emission reduction activities undertaken or planned", "text"),
    ("", "Data quality", None),
    ("DQ.1", "Describe the share of primary (metered/invoiced) versus estimated data in your Scope 1 and 2 figures", "text"),
]


def main() -> int:
    wb = Workbook()
    ws = wb.active
    ws.title = "Climate module"
    ws["A1"] = "Supplier Climate Questionnaire — SME (aligned to CDP 2026 SME climate data points)"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = "Please answer in column C. Leave a cell blank if the data is unavailable and explain in column D."
    ws["A2"].font = Font(italic=True, color="555555")
    ws.append([])
    ws.append(["Ref", "Question", "Response", "Notes / evidence"])
    for c in ("A", "B", "C", "D"):
        ws[f"{c}4"].font = Font(bold=True)
        ws[f"{c}4"].fill = PatternFill("solid", fgColor="E8EEF5")
    for ref, text, kind in QUESTIONS:
        if kind is None:
            ws.append([None, text, None, None])
            ws.cell(row=ws.max_row, column=2).font = Font(bold=True)
            ws.cell(row=ws.max_row, column=2).fill = PatternFill("solid", fgColor="F3F3F0")
        else:
            ws.append([ref, text, None, None])
    ws.column_dimensions["A"].width = 9
    ws.column_dimensions["B"].width = 84
    ws.column_dimensions["C"].width = 34
    ws.column_dimensions["D"].width = 50
    for row in ws.iter_rows(min_row=5):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} with {sum(1 for q in QUESTIONS if q[2])} questions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
