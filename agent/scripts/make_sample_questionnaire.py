"""Write the sample customer questionnaire offered on the Questionnaire step.

    PYTHONPATH=. .venv/bin/python -m scripts.make_sample_questionnaire

A blank supplier survey of the kind a Japanese buyer sends: one sheet, Japanese first with English
under it, a header row of No. / question / answer / unit / notes, and sections for company details,
emissions, energy, intensity and allocation, targets and actions, and data quality. It is written by us
(not a copy of any buyer's file) and matches the sample bills in `web/public/sample-bills-japan.zip`:
the same reporting year (April 2025 to March 2026) and the same fuels (electricity, city gas, LPG,
diesel, petrol), so a tester can go from the bills to a filled sheet. Units are the ones Japanese sheets
use (kWh, m³, kL, t-CO2e), so unit conversion shows; the target and intensity questions are ones bills
cannot answer, so the honest gaps show too.
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "sample-questionnaire-japan.xlsx"

SHEET = "調査票"

# (number, question in Japanese and English, unit, dropdown list name or None). A row with no number is a section heading.
ROWS: list[tuple[str | None, str, str | None, str | None]] = [
    (None, "1. 会社情報 / Company information", None, None),
    ("1.1", "会社名\nCompany name", None, None),
    ("1.2", "所在国\nCountry where your sites are located", None, "country"),
    ("1.3", "報告対象期間(開始日)\nReporting period start date", "YYYY-MM-DD", None),
    ("1.4", "報告対象期間(終了日)\nReporting period end date", "YYYY-MM-DD", None),
    ("1.5", "対象拠点\nSites included in this response", None, None),
    (None, "2. 温室効果ガス排出量 / Greenhouse gas emissions", None, None),
    ("2.1", "スコープ1排出量(燃料の燃焼、冷媒の漏えい)\nScope 1 emissions (fuel combustion, refrigerant leakage)", "t-CO2e", None),
    ("2.2", "スコープ2排出量(ロケーション基準)\nScope 2 emissions, location-based", "t-CO2e", None),
    ("2.3", "スコープ2排出量(マーケット基準)\nScope 2 emissions, market-based", "t-CO2e", None),
    ("2.4", "算定方法と使用した排出係数をご記入ください\nDescribe the calculation method and the emission factors used", None, None),
    ("2.5", "スコープ3排出量(任意)と対象カテゴリ\nScope 3 emissions (optional) and the categories covered", "t-CO2e", None),
    ("2.6", "排出量について第三者検証を受けていますか\nAre your emissions verified by a third party?", None, "yesno"),
    (None, "3. エネルギー使用量 / Energy use", None, None),
    ("3.1", "購入電力量\nPurchased electricity", "kWh", None),
    ("3.2", "都市ガス使用量\nCity gas (natural gas) used", "m³", None),
    ("3.3", "LPG使用量\nLPG used", "kg", None),
    ("3.4", "軽油使用量\nDiesel used", "kL", None),
    ("3.5", "ガソリン使用量\nPetrol used", "kL", None),
    (None, "4. 原単位・配分 / Intensity and allocation", None, None),
    ("4.1", "売上高あたりの排出量(スコープ1+2)\nScope 1+2 emissions per unit of revenue", "t-CO2e/百万円", None),
    ("4.2", "当社向けに配分した排出量と配分方法\nEmissions allocated to our company, and the allocation method", "t-CO2e", None),
    (None, "5. 目標・取組 / Targets and actions", None, None),
    ("5.1", "排出削減目標はありますか。内容をご記入ください\nDo you have an emissions reduction target? Describe it", None, None),
    ("5.2", "実施中または計画中の削減取組をご記入ください\nDescribe reduction activities under way or planned", None, None),
    (None, "6. データ品質 / Data quality", None, None),
    ("6.1", "実測・請求書データと推計データの割合\nShare of measured or invoiced data versus estimated data", "%", None),
]

LISTS = {"country": ("日本", "ベトナム", "タイ", "インドネシア", "その他"), "yesno": ("はい", "いいえ")}

INK = "1F2A27"
HEAD = PatternFill("solid", fgColor="0E7C72")
SECTION = PatternFill("solid", fgColor="EEF1EF")
ANSWER = PatternFill("solid", fgColor="FFF8DC")
THIN = Side(style="thin", color="C9D3CF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def build() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET
    ws.sheet_view.showGridLines = False

    ws["A1"] = "サプライヤー温室効果ガス排出量調査票 2025年度(サンプル) / Supplier GHG Emissions Survey FY2025 (sample)"
    ws["A1"].font = Font(bold=True, size=14, color=INK)
    ws["A2"] = ("回答はC列にご記入ください。不明な場合は空欄のままとし、D列に理由をご記入ください。\n"
                "Please answer in column C. If a figure is unknown, leave it blank and explain in column D.")
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws["A2"].font = Font(size=10, color="5B6662")
    ws.merge_cells("A1:E1")
    ws.merge_cells("A2:E2")
    ws.row_dimensions[2].height = 32

    header = ["No.", "質問 / Question", "回答 / Answer", "単位 / Unit", "備考 / Notes"]
    for col, text in enumerate(header, 1):
        c = ws.cell(4, col, text)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = HEAD
        c.alignment = Alignment(vertical="center")
        c.border = BOX
    ws.row_dimensions[4].height = 20

    # Hidden sheet holding the dropdown values, as buyer sheets usually do.
    lists = wb.create_sheet("リスト")
    ranges: dict[str, str] = {}
    for col, (name, values) in enumerate(LISTS.items(), 1):
        letter = chr(64 + col)
        for i, v in enumerate(values, 1):
            lists.cell(i, col, v)
        ranges[name] = f"リスト!${letter}$1:${letter}${len(values)}"
    lists.sheet_state = "hidden"
    validations = {name: DataValidation(type="list", formula1=rng, allow_blank=True) for name, rng in ranges.items()}
    for dv in validations.values():
        ws.add_data_validation(dv)

    r = 5
    for num, question, unit, dropdown in ROWS:
        if num is None:
            c = ws.cell(r, 1, question)
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
            c.font = Font(bold=True, color=INK)
            for col in range(1, 6):
                ws.cell(r, col).fill = SECTION
                ws.cell(r, col).border = BOX
            ws.row_dimensions[r].height = 20
        else:
            ws.cell(r, 1, num)
            ws.cell(r, 2, question)
            ws.cell(r, 4, unit)
            for col in range(1, 6):
                cell = ws.cell(r, col)
                cell.border = BOX
                cell.alignment = Alignment(wrap_text=True, vertical="top")
                cell.font = Font(color=INK, size=10)
            ws.cell(r, 3).fill = ANSWER
            ws.row_dimensions[r].height = 34
            if dropdown:
                validations[dropdown].add(f"C{r}")
        r += 1

    for letter, width in (("A", 7), ("B", 58), ("C", 30), ("D", 14), ("E", 32)):
        ws.column_dimensions[letter].width = width
    ws.freeze_panes = "A5"
    return wb


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    build().save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
