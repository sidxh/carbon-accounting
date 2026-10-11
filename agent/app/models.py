"""Domain models shared by every stage of the pipeline.

The shapes here are deliberately boring: they are what an auditor expects to
see. Every number that reaches a questionnaire is an `InventoryLine`, and an
`InventoryLine` always names the document, the factor and the assumptions it
came from.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class EnergyType(StrEnum):
    ELECTRICITY = "electricity"
    DIESEL = "diesel"
    PETROL = "petrol"
    LPG = "lpg"
    NATURAL_GAS = "natural_gas"
    KEROSENE = "kerosene"
    COAL = "coal"
    BIOMASS = "biomass"
    REFRIGERANT = "refrigerant"
    PURCHASED_STEAM = "purchased_steam"
    PURCHASED_COOLING = "purchased_cooling"
    OTHER = "other"


SCOPE_OF: dict[EnergyType, int] = {
    EnergyType.ELECTRICITY: 2,
    EnergyType.PURCHASED_STEAM: 2,
    EnergyType.PURCHASED_COOLING: 2,
    EnergyType.DIESEL: 1,
    EnergyType.PETROL: 1,
    EnergyType.LPG: 1,
    EnergyType.NATURAL_GAS: 1,
    EnergyType.KEROSENE: 1,
    EnergyType.COAL: 1,
    EnergyType.BIOMASS: 1,
    EnergyType.REFRIGERANT: 1,
    EnergyType.OTHER: 1,
}


class Unit(StrEnum):
    KWH = "kWh"
    MWH = "MWh"
    LITRE = "L"
    KG = "kg"
    TONNE = "t"
    M3 = "m3"
    GJ = "GJ"
    HOUR = "h"  # generator runtime; converted with a rated consumption assumption


Tier = Literal["primary", "secondary", "estimated"]
FactorMethod = Literal["location", "market", "residual_mix", "supplier_specific", "fuel", "gwp", "biogenic"]


class Factor(BaseModel):
    id: str
    country: str = Field(description="ISO 3166-1 alpha-2, or 'GLOBAL' for IPCC/DEFRA defaults")
    region: str | None = Field(default=None, description="Sub-national grid region, e.g. AU-NSW")
    year: int
    energy_type: EnergyType
    method: FactorMethod
    value: float = Field(description="kgCO2e per `unit` (or biogenic kgCO2 for method=biogenic)")
    unit: Unit
    source_name: str
    source_url: str
    vintage: str = Field(description="Publication or dataset year as printed by the source")
    gas: str | None = Field(default=None, description="Refrigerant blend for gwp rows, e.g. R-410A")
    notes: str = ""

    def citation(self) -> str:
        where = self.region or self.country
        return (
            f"{self.value:g} kgCO2e/{self.unit} — {self.source_name} ({self.vintage}), "
            f"{where} {self.year}, {self.method}. {self.source_url}"
        )


class Site(BaseModel):
    id: str
    name: str
    country: str
    region: str | None = None
    address: str | None = None
    # Filled in by the reduction advisor's "locate" step; the roof area is the supplier's own figure.
    lat: float | None = None
    lng: float | None = None
    formatted_address: str | None = None
    # "approximate" when the address only matched a street or area, so the roof may be the wrong one.
    location_precision: Literal["exact", "approximate"] | None = None
    roof_area_m2: float | None = None


class SupplierProfile(BaseModel):
    id: str
    name: str = ""
    country: str = "VN"
    language: str = "vi"
    # Only the default for a new reporting period; the period is the truth.
    fiscal_year_start: date
    fiscal_year_end: date
    sites: list[Site] = Field(default_factory=list)
    sector: str = ""
    revenue: float | None = None
    revenue_currency: str | None = None
    created_at: datetime | None = None
    # From the verified sign-in token, so a supplier document can be matched to a person in the
    # Firestore console without opening Authentication. The uid (the document id) stays the key.
    email: str | None = None

    def for_period(self, period: "ReportingPeriod") -> "SupplierProfile":
        """The profile with this period's dates in the FY slots, so code that
        reads `fiscal_year_*` (reconciler, filler, exporter) sees the period."""
        return self.model_copy(update={"fiscal_year_start": period.start, "fiscal_year_end": period.end})


class ReportingPeriod(BaseModel):
    """One reporting year. Bills, the conversation and the inventory belong to
    a period; several customer requests can share it."""

    id: str
    label: str
    start: date
    end: date
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


RequestStatus = Literal["new", "bills", "questions", "inventory", "filled"]


class Request(BaseModel):
    """A customer asked for numbers. Points at the period whose inventory
    answers it; owns only its questionnaire, template and allocation share."""

    id: str
    customer_name: str
    period_id: str
    template_filename: str | None = None
    template_key: str | None = None
    due_date: date | None = None
    customer_share: float | None = None
    questionnaire_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MeterRegister(BaseModel):
    """One register of a meter as printed on a bill (normal / peak / night ...)."""

    label: str = ""
    previous: float | None = None
    current: float | None = None
    multiplier: float = 1.0
    consumption: float | None = Field(default=None, description="Consumption printed for this register")


class LineCheck(BaseModel):
    """Result of one deterministic plausibility check on an activity line."""

    id: Literal["index", "price", "season"]
    status: Literal["pass", "fail", "confirmed"]
    detail: str = ""


class ActivityLine(BaseModel):
    """One consumption record read from one document, before reconciliation."""

    id: str
    supplier_id: str
    source_doc_id: str
    site_id: str | None = None
    energy_type: EnergyType
    quantity: float
    unit: Unit
    period_start: date
    period_end: date
    gas: str | None = None  # refrigerant blend
    vendor: str | None = None
    amount: float | None = None
    currency: str | None = None
    confidence: float = 1.0
    tier: Tier = "primary"
    assumption_ids: list[str] = Field(default_factory=list)
    notes: str = ""
    # Where the printed quantity sits on the source page, [ymin, xmin, ymax, xmax]
    # normalised to 0..1000, so the UI can show the value on the original bill.
    quantity_box: list[int] | None = None
    period_box: list[int] | None = None
    page: int = 1
    registers: list[MeterRegister] = Field(default_factory=list)
    checks: list[LineCheck] = Field(default_factory=list)


class Assumption(BaseModel):
    id: str
    supplier_id: str
    question: str
    answer: str
    applied_to: list[str] = Field(default_factory=list, description="activity line ids")
    method: str = ""
    created_at: datetime | None = None


class InventoryLine(BaseModel):
    """One computed line: activity × factor, with full lineage."""

    id: str
    supplier_id: str
    site_id: str | None
    scope: int
    energy_type: EnergyType
    quantity: float
    unit: Unit
    factor_id: str
    factor_value: float
    factor_citation: str
    method: FactorMethod
    basis: Literal["location", "market"] | None = Field(
        default=None,
        description="For Scope 2: which reporting basis this row feeds. `method` is the factor "
        "actually used, which can be `location` on a market row when the hierarchy fell back.",
    )
    kg_co2e: float
    biogenic_kg_co2: float = 0.0
    tier: Tier
    source_doc_id: str
    activity_line_id: str
    assumption_ids: list[str] = Field(default_factory=list)
    period_start: date
    period_end: date
    # Factor provenance, broken out so the UI can render a factor card rather
    # than parse the citation string.
    factor_source_name: str = ""
    factor_source_url: str = ""
    factor_vintage: str = ""
    factor_country: str = ""
    factor_region: str | None = None
    factor_year: int | None = None
    factor_gas: str | None = None
    exact_year: bool = True
    exact_region: bool = True
    fell_back_to: str | None = None
    activity_notes: str = ""


class InventoryTotals(BaseModel):
    scope1_kg: float
    scope2_location_kg: float
    scope2_market_kg: float
    biogenic_kg: float
    by_site: dict[str, dict[str, float]]
    by_energy_type: dict[str, float]
    tier_mix: dict[str, float] = Field(description="share of kgCO2e by tier")
    line_count: int
    by_month: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description="YYYY-MM -> {scope1, scope2_location, estimated} kgCO2e; headline rows apportioned by days",
    )
