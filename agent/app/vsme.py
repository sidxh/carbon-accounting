"""Fill EFRAG's own VSME Digital Template (modules B1 and B3), deterministically.

An EU buyer that must report value-chain data under the VSME standard sends, or accepts, EFRAG's
Excel template. We fill that exact file through the template's own named ranges, so no model maps
anything and the file converts to XBRL with EFRAG's tooling.

Every number comes from `facts.compute_fact`, the same place the questionnaire filler and the answer
packs read from.

Why the sheet XML is patched in the zip and not saved through openpyxl: the template carries x14 data
validations (the country dropdown, for one) that openpyxl would drop when saving. Patching the cells
in place keeps every other part of the package byte-for-byte as EFRAG shipped it.

The template computes its own validation status ("OK", "Missing value") with formulas. We leave those
formulas alone and set `fullCalcOnLoad`, so Excel recalculates when the file is opened. The file must
be opened in Excel once before it is converted.
"""

from __future__ import annotations

import io
import re
import warnings
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any
from xml.sax.saxutils import escape, unescape

from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string, get_column_letter

from .facts import FactContext, compute_fact
from .questionnaires import get_bank, templates_dir

BANK_ID = "vsme_b3"
START_DATE_RANGE = "template_reporting_period_startdate"
END_DATE_RANGE = "template_reporting_period_enddate"
# The template has no named range for these two inputs, so they are located by their B1 row.
IDENTIFIER_LABEL = "Identifier of the reporting entity"
BASIS_LABEL = "Basis for preparation (Option A, Basic Module only, or Option B)"
COUNTING_LABEL = "Employee counting methodology (end of reporting period, or average)"


class VsmeError(RuntimeError):
    """The template is not the one we know how to fill."""


@dataclass
class Filled:
    ref: str
    label: str
    cell: str                       # 'General Information'!D3
    value: str | float | int
    source: str


@dataclass
class OpenItem:
    ref: str
    label: str
    reason: str


@dataclass
class VsmeResult:
    xlsx: bytes
    filled: list[Filled] = field(default_factory=list)
    open_items: list[OpenItem] = field(default_factory=list)


# --- reading the package ---------------------------------------------------------------------------

def _read_zip(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {i.filename: z.read(i.filename) for i in z.infolist()}


def _names(workbook_xml: str) -> dict[str, str]:
    """Defined name -> its reference, e.g. 'Turnover' -> "'General Information'!$E$283"."""
    return {m.group(1): unescape(m.group(2), {"&apos;": "'", "&quot;": '"'})
            for m in re.finditer(r'<definedName name="([^"]+)"[^>]*>([^<]*)</definedName>', workbook_xml)}


def _sheet_parts(files: dict[str, bytes]) -> dict[str, str]:
    """Sheet name -> the part that holds it, e.g. 'General Information' -> 'xl/worksheets/sheet4.xml'."""
    wb = files["xl/workbook.xml"].decode("utf-8")
    rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
    target = {m.group(1): m.group(2) for m in re.finditer(r'<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"', rels)}
    target.update({m.group(2): m.group(1) for m in re.finditer(r'<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"', rels)})
    out = {}
    for m in re.finditer(r'<sheet name="([^"]+)"[^>]*?r:id="([^"]+)"', wb):
        out[unescape(m.group(1), {"&apos;": "'", "&quot;": '"'})] = "xl/" + target[m.group(2)].lstrip("/").removeprefix("xl/")
    return out


def _cell_of(ref: str) -> tuple[str, str]:
    """"'General Information'!$D$3:$E$3" -> ('General Information', 'D3'): the first cell of the range."""
    sheet, rng = ref.rsplit("!", 1)
    first = rng.split(":")[0].replace("$", "")
    return sheet.strip("'"), first


def _split(coord: str) -> tuple[str, int]:
    m = re.fullmatch(r"([A-Z]+)(\d+)", coord)
    assert m
    return m.group(1), int(m.group(2))


# --- the lists the template validates against --------------------------------------------------------

@lru_cache
def _lists(path: str) -> dict[str, Any]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = load_workbook(path, read_only=True)
        ws = wb["Enumeration Lists"]
        rows = list(ws.iter_rows(min_row=2, max_row=1100, max_col=26, values_only=True))
    col = lambda i: [r[i] for r in rows if len(r) > i and r[i] not in (None, "")]
    countries = {}
    for r in rows:
        if r[2] and r[3] and str(r[3]).startswith("country:"):
            countries[str(r[3]).split(":", 1)[1]] = str(r[2])
    return {
        "nace": [str(x) for x in col(0) if str(x).startswith("NACE ")],
        "currencies": [str(x) for x in col(24)],
        "countries": countries,
    }


_NACE_ENTRY = re.compile(r"^NACE ([A-U]) - (\d{2}(?:\.\d{1,2})?) ")


def nace_entry(code: str, entries: list[str]) -> str | None:
    """The template's list text for a NACE code written as 'C.13.20', 'C 13.20', 'NACE C - 13.20' or '13.20'.

    A division or class code matches that entry exactly; a section letter alone matches the section."""
    s = re.sub(r"(?i)^nace", "", code.strip()).strip(" -.:")
    m = re.fullmatch(r"(?i)([A-U])?[\s.\-]*(\d{1,2}(?:\.\d{1,2})?)?", s)
    if not m or not (m.group(1) or m.group(2)):
        return None
    letter, num = (m.group(1) or "").upper(), m.group(2)
    if num is None:
        return next((e for e in entries if re.match(rf"^NACE {letter} - [^\d]+$", e)), None)
    if len(num) == 1:
        num = "0" + num
    for e in entries:
        mm = _NACE_ENTRY.match(e)
        if mm and mm.group(2) == num and (not letter or mm.group(1) == letter):
            return e
    return None


# --- patching a cell ------------------------------------------------------------------------------

def _style_of(attrs: str) -> int:
    m = re.search(r'\ss="(\d+)"', attrs)
    return int(m.group(1)) if m else 0


def _with_style(attrs: str, style: int) -> str:
    if re.search(r'\ss="\d+"', attrs):
        return re.sub(r'\ss="\d+"', f' s="{style}"', attrs)
    return f'{attrs} s="{style}"'


def _patch(xml: str, coord: str, value: str | float, restyle: Callable[[int], int] | None = None) -> str:
    """Put a value in an empty input cell, keeping its style (or the `restyle` of it). Formula cells are never overwritten."""
    pat = re.compile(rf'<c r="{coord}"(?P<attrs>[^>]*?)(?:/>|>(?P<body>.*?)</c>)', re.DOTALL)
    m = pat.search(xml)
    if m is None:
        raise VsmeError(f"cell {coord} is not in the template, which is not the version we know")
    if m.group("body") and "<f" in m.group("body"):
        raise VsmeError(f"cell {coord} holds a formula")
    attrs = re.sub(r'\s+t="[^"]*"', "", m.group("attrs"))
    if restyle is not None:
        attrs = _with_style(attrs, restyle(_style_of(attrs)))
    if isinstance(value, str):
        new = f'<c r="{coord}"{attrs} t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
    else:
        new = f'<c r="{coord}"{attrs}><v>{value!r}</v></c>'
    return xml[:m.start()] + new + xml[m.end():]


def _is_formula(xml: str, coord: str) -> bool:
    m = re.search(rf'<c r="{coord}"[^>]*?(?:/>|>(.*?)</c>)', xml, re.DOTALL)
    return bool(m and m.group(1) and "<f" in m.group(1))


def _restyle_cell(xml: str, coord: str, restyle: Callable[[int], int]) -> str:
    """Change only the style of a cell that stays as it is (an input we leave for the supplier). A formula cell, or one
    that the sheet does not carry, is left alone."""
    m = re.search(rf'<c r="{coord}"(?P<attrs>[^>]*?)(?P<end>/>|>(?P<body>.*?)</c>)', xml, re.DOTALL)
    if m is None or (m.group("body") and "<f" in m.group("body")):
        return xml
    attrs = _with_style(m.group("attrs"), restyle(_style_of(m.group("attrs"))))
    tail = m.group("end")
    return xml[:m.start()] + f'<c r="{coord}"{attrs}{tail}' + xml[m.end():]


# --- colours: green = filled from the supplier's data, yellow = for the supplier -----------------------
# The template's cells keep their borders, number formats and unlocked state: each coloured cell gets a copy of its
# own cell format with only the fill replaced. Nothing else in styles.xml is touched.

GREEN, YELLOW = "FFCDEBD5", "FFFFF0B3"


class _Styler:
    def __init__(self, xml: str):
        self.xml = xml
        fills = re.search(r'<fills count="(\d+)">', xml)
        xfs = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', xml, re.DOTALL)
        if not fills or not xfs:
            raise VsmeError("styles.xml is not the layout we know")
        self.fill_base = int(fills.group(1))
        self.xfs = re.findall(r"<xf\b[^>]*?(?:/>|>.*?</xf>)", xfs.group(2), re.DOTALL)
        if len(self.xfs) != int(xfs.group(1)):
            raise VsmeError("styles.xml cell formats could not be counted")
        self.clones: list[str] = []
        self.index: dict[tuple[int, str], int] = {}
        self.fill_id = {GREEN: self.fill_base, YELLOW: self.fill_base + 1}

    def _clone(self, base: int, color: str) -> int:
        key = (base, color)
        if key not in self.index:
            xf = self.xfs[base]
            end = xf.index(">")
            head, close = (xf[:end - 1], "/>") if xf[:end].endswith("/") else (xf[:end], ">")
            head = re.sub(r'\s(?:fillId|applyFill)="\d+"', "", head)
            self.clones.append(f'{head} fillId="{self.fill_id[color]}" applyFill="1"{close}{xf[end + 1:]}')
            self.index[key] = len(self.xfs) + len(self.clones) - 1
        return self.index[key]

    def to(self, color: str) -> Callable[[int], int]:
        return lambda base: self._clone(base, color)

    def render(self) -> str:
        solid = '<fill><patternFill patternType="solid"><fgColor rgb="{}"/><bgColor indexed="64"/></patternFill></fill>'
        xml = self.xml
        xml = re.sub(r'<fills count="\d+">', f'<fills count="{self.fill_base + 2}">', xml, count=1)
        xml = xml.replace("</fills>", solid.format(GREEN) + solid.format(YELLOW) + "</fills>", 1)
        xml = re.sub(r'<cellXfs count="\d+">', f'<cellXfs count="{len(self.xfs) + len(self.clones)}">', xml, count=1)
        return xml.replace("</cellXfs>", "".join(self.clones) + "</cellXfs>", 1)


def _open_on(files: dict[str, bytes], parts: dict[str, str], sheet: str, cell: str) -> None:
    """Make `sheet` the one Excel shows first, with `cell` selected. EFRAG's file opens on "Language Selection", a
    nearly empty sheet, so a filled file looks as if nothing was written."""
    order = [unescape(m.group(1), {"&apos;": "'", "&quot;": '"'}) for m in re.finditer(r'<sheet name="([^"]+)"', files["xl/workbook.xml"].decode("utf-8"))]
    wb_xml = files["xl/workbook.xml"].decode("utf-8")
    wb_xml = re.sub(r'\sactiveTab="\d+"', "", wb_xml)
    files["xl/workbook.xml"] = re.sub(r"<workbookView ", f'<workbookView activeTab="{order.index(sheet)}" ', wb_xml, count=1).encode("utf-8")
    for name, part in parts.items():
        xml = files[part].decode("utf-8")
        xml = re.sub(r'\stabSelected="1"', "", xml)
        if name == sheet:
            def view(m: re.Match) -> str:
                attrs = re.sub(r'\s(?:tabSelected|topLeftCell)="[^"]*"', "", m.group(1))
                body = re.sub(r"<selection\b[^>]*/>", "", m.group(3) or "")
                return f'<sheetView{attrs} tabSelected="1">{body}<selection activeCell="{cell}" sqref="{cell}"/></sheetView>'
            xml = re.sub(r"<sheetView\b([^>]*?)(/>|>(.*?)</sheetView>)", view, xml, count=1, flags=re.DOTALL)
        files[part] = xml.encode("utf-8")


# --- the fill ---------------------------------------------------------------------------------------

def fill_vsme(ctx: FactContext, template: bytes | None = None) -> VsmeResult:
    """Fill the VSME template for this supplier's inventory. Returns the file and what it could not fill."""
    bank = get_bank(BANK_ID)
    path = templates_dir() / (bank.template_file or "")
    data = template if template is not None else path.read_bytes()
    files = _read_zip(data)
    names = _names(files["xl/workbook.xml"].decode("utf-8"))
    parts = _sheet_parts(files)
    sheets = {n: files[p].decode("utf-8") for n, p in parts.items() if n in {"General Information", "Environmental Disclosures"}}
    lists = _lists(str(path))
    p = ctx.profile
    result = VsmeResult(b"")
    styler = _Styler(files["xl/styles.xml"].decode("utf-8"))

    def put(ref: str, label: str, name: str, value: str | float, source: str, dx: int = 0, dy: int = 0) -> None:
        sheet, coord = _cell_of(names[name])
        col, row = _split(coord)
        coord = f"{get_column_letter(column_index_from_string(col) + dx)}{row + dy}"
        sheets[sheet] = _patch(sheets[sheet], coord, value, styler.to(GREEN))
        result.filled.append(Filled(ref, label, f"'{sheet}'!{coord}", value, source))

    def open_item(ref: str, label: str, reason: str, *ranges: str) -> None:
        """Report what is left, and colour the input cell(s) the supplier has to fill (first cell of each named range)."""
        result.open_items.append(OpenItem(ref, label, reason))
        for rng in ranges:
            if rng in names:
                sheet, coord = _cell_of(names[rng])
                if sheet in sheets:
                    sheets[sheet] = _restyle_cell(sheets[sheet], coord, styler.to(YELLOW))

    for q in bank.questions:
        name = q.named_range
        if name is None or name not in names:
            raise VsmeError(f"named range {name!r} is not in the template")
        f = q.field
        if f == "ghg_intensity_turnover":
            continue                                  # a formula in the template, computed when the file opens
        if f is None:
            open_item(q.ref, q.text, q.note or "Only the supplier can answer this.", name)
            continue
        if f == "reporting_period":
            sheet, coord = _cell_of(names[START_DATE_RANGE])
            if not _is_formula(sheets[sheet], coord):
                raise VsmeError("the start date is not a formula of year, month and day cells")
            for rng, d in ((START_DATE_RANGE, p.fiscal_year_start), (END_DATE_RANGE, p.fiscal_year_end)):
                for dy, part in zip((-3, -2, -1), (d.year, d.month, d.day), strict=True):
                    put(q.ref, "Reporting period " + ("start" if rng == START_DATE_RANGE else "end"), rng, part,
                        "supplier profile (fiscal year)", dy=dy)
            continue
        fact = compute_fact(f, ctx)
        if fact.flagged or fact.value is None:
            open_item(q.ref, q.text, fact.reason or "No value in the supplier's data.", name)
            continue
        value = fact.value
        if f == "currency":
            if str(value).upper() not in lists["currencies"]:
                open_item(q.ref, q.text, f"{value!r} is not in the template's currency list.", name)
                continue
            value = str(value).upper()
        elif f == "sector_code":
            entry = nace_entry(str(value), lists["nace"])
            if entry is None:
                open_item(q.ref, q.text, f"NACE code {value!r} is not in the template's list. Pick it from the dropdown.", name)
                continue
            value = entry
        elif f == "country":
            name_ = lists["countries"].get(str(value).upper())
            if name_ is None:
                open_item(q.ref, q.text, f"Country code {value!r} is not in the template's list.", name)
                continue
            value = name_
        elif f == "employees":
            # the template's own row two below the count: "Headcount" or "Full-time equivalent (FTE)"
            put("B1 24(e)(v)", "Employee counting: headcount", name, "Headcount", "supplier profile (headcount)", dy=2)
        put(q.ref, q.text, name, value, fact.source)

    open_item("B1 basis", BASIS_LABEL, "Choose Option A (Basic Module only) or B in the template. Its checks stay silent until you do.", "BasisForPreparation")
    open_item("B1 4", IDENTIFIER_LABEL, "The entity identifier (a LEI or registration number and its scheme) is the supplier's to enter.",
              "template_reporting_entity_identifier_scheme", "template_reporting_entity_identifier")
    if any(f.label.startswith("Employee counting") for f in result.filled):
        open_item("B1 24(e)(v)", COUNTING_LABEL, "Choose whether the headcount is taken at the end of the period or as an average.", "EmployeeCountingMethodology")

    for sheet, xml in sheets.items():
        files[parts[sheet]] = xml.encode("utf-8")
    files["xl/styles.xml"] = styler.render().encode("utf-8")
    _open_on(files, parts, "General Information", "D3")
    wb_xml = files["xl/workbook.xml"].decode("utf-8")
    if "fullCalcOnLoad" not in wb_xml:
        wb_xml, n = re.subn(r"<calcPr ", '<calcPr fullCalcOnLoad="1" ', wb_xml, count=1)
        if n == 0:
            wb_xml = wb_xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')
    files["xl/workbook.xml"] = wb_xml.encode("utf-8")
    result.xlsx = _write_zip(data, files)
    return result


def _write_zip(original: bytes, files: dict[str, bytes]) -> bytes:
    """Rewrite the package with the same member order and compression as EFRAG's file."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            dst.writestr(info.filename, files[info.filename], compress_type=info.compress_type)
    return out.getvalue()
