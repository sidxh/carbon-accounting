"""Read one document — a photo or PDF of a bill — into structured activity data.

This is the one place Gemini does something no template parser can: a
Vietnamese EVN bill, a handwritten Japanese delivery note and an Australian
tax invoice share no layout, and the model reads all three into the same
schema. The schema is strict (`response_schema`), so the output is data, not
prose, and every line carries a confidence the UI can show.

The model reads. It does not compute: quantities are copied from the
document, never derived from amounts, and nothing here touches a factor.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from ..gemini import ImagePart, get_gemini
from ..models import ActivityLine, EnergyType, Unit

DocType = Literal[
    "electricity_bill",
    "fuel_invoice",
    "gas_bill",
    "refrigerant_service",
    "steam_or_cooling_bill",
    "other",
]

EnergyTypeStr = Literal[
    "electricity", "diesel", "petrol", "lpg", "natural_gas", "kerosene", "coal",
    "biomass", "refrigerant", "purchased_steam", "purchased_cooling", "other",
]
UnitStr = Literal["kWh", "MWh", "L", "kg", "t", "m3", "GJ", "h"]


class ExtractedLine(BaseModel):
    energy_type: EnergyTypeStr
    quantity: float = Field(description="Consumption quantity exactly as printed. Never derived from money.")
    unit: UnitStr
    period_start: str = Field(description="ISO date YYYY-MM-DD. For a delivery, the delivery date.")
    period_end: str = Field(description="ISO date YYYY-MM-DD. For a delivery, the same as period_start.")
    gas: str | None = Field(default=None, description="Refrigerant blend such as R-410A, only for refrigerant lines")
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(description="The printed label or row the quantity was read from, verbatim")


class ExtractedDocument(BaseModel):
    doc_type: DocType
    language: str = Field(description="BCP-47 code of the document language, e.g. vi, ja, en")
    vendor: str | None = None
    customer: str | None = None
    site_hint: str | None = Field(default=None, description="Address fragment identifying the site served")
    currency: str | None = None
    total_amount: float | None = Field(default=None, description="Total payable as printed, for reference only")
    lines: list[ExtractedLine]
    confidence: float = Field(ge=0, le=1, description="Overall confidence that the document was read correctly")
    warnings: list[str] = Field(default_factory=list, description="Anything ambiguous a human should look at")


SYSTEM = """You read utility bills, fuel invoices and equipment service slips for a greenhouse-gas
inventory. Documents may be in Vietnamese, Japanese, Thai, Bahasa, English or other languages, and
may be photographs. Return only the structured record.

Rules that matter for accounting:
- Report CONSUMPTION QUANTITIES, never money. For electricity report the total kWh used in the
  billing period (the sum across registers such as normal/peak/off-peak or day/night), not any single
  register and not meter index readings. For fuel deliveries report the litres or kg delivered.
  For refrigerant service report the kg of refrigerant CHARGED (nạp / 補充 / top-up), not the
  system's total charge, and name the blend (R-410A, R-22, R-134a ...).
- Dates: the billing period printed on the bill (kỳ hóa đơn từ ... đến ..., ご使用期間, billing
  period). Vietnamese dates are DD/MM/YYYY. Japanese dates are YYYY年MM月DD日. A single delivery is a
  one-day period equal to the delivery date. If an LPG invoice states a usage month (kỳ sử dụng
  tháng M/YYYY), use the first and last day of that month.
- Units: use exactly one of kWh, MWh, L, kg, t, m3, GJ, h. LPG sold by cylinder count: report the
  total kg printed, not the number of cylinders. Generator runtime in hours is "h".
- energy_type: electricity for grid bills; diesel for dầu DO / 軽油 / diesel; lpg for gas LPG /
  LPガス / プロパン; natural_gas for city gas / piped gas; refrigerant for service slips charging gas.
- One document usually yields one line. Multiple fuel types on one invoice yield one line each.
- Set confidence below 0.7 when a value is hard to read or ambiguous, and say why in warnings.
- Do not invent fields. Leave optional fields null when absent."""


def extract(data: bytes, mime_type: str) -> ExtractedDocument:
    prompt = "Extract the activity data from this document."
    return get_gemini().generate_structured(
        prompt, ExtractedDocument, images=[ImagePart(data=data, mime_type=mime_type)], system=SYSTEM
    )


def _iso(s: str) -> date:
    return date.fromisoformat(s.strip()[:10])


def to_activity_lines(
    doc: ExtractedDocument,
    *,
    supplier_id: str,
    source_doc_id: str,
    site_id: str | None,
) -> list[ActivityLine]:
    out: list[ActivityLine] = []
    for ln in doc.lines:
        try:
            et = EnergyType(ln.energy_type)
            unit = Unit(ln.unit)
            ps, pe = _iso(ln.period_start), _iso(ln.period_end)
        except (ValueError, KeyError):
            continue
        if pe < ps:
            ps, pe = pe, ps
        out.append(
            ActivityLine(
                id=f"al_{uuid.uuid4().hex[:10]}",
                supplier_id=supplier_id,
                source_doc_id=source_doc_id,
                site_id=site_id,
                energy_type=et,
                quantity=ln.quantity,
                unit=unit,
                period_start=ps,
                period_end=pe,
                gas=(ln.gas or None),
                vendor=doc.vendor,
                amount=doc.total_amount,
                currency=doc.currency,
                confidence=ln.confidence,
                tier="primary",
                notes=ln.evidence,
            )
        )
    return out
