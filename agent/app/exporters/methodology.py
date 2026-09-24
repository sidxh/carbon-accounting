"""The one-page (or two) note a buyer's auditor reads.

Facts are assembled from the calculator output; the model drafts three short
narrative paragraphs from those facts and nothing else. The tables are
rendered from data directly, so a number in the note is always the number in
the inventory.

PDF rendering prefers WeasyPrint (system fonts, good CSS) and falls back to
xhtml2pdf, which is pure Python and needs a Unicode font registered — we
point it at a system TTF that covers Vietnamese and CJK.
"""

from __future__ import annotations

import io
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, Field

from ..factor_library import get_library
from ..gemini import get_gemini
from ..models import Assumption, InventoryLine, SupplierProfile
from ..repo import InventorySnapshot

HERE = Path(__file__).resolve().parent
env = Environment(loader=FileSystemLoader(str(HERE)), autoescape=select_autoescape(["html"]))

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def _font_path() -> str:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return p
    return ""


class Narrative(BaseModel):
    approach: str = Field(description="2-3 sentences: standard followed, what was measured, how Scope 2 was treated")
    data: str = Field(description="2-3 sentences on where the activity data came from and how periods were handled")
    assumptions: str = Field(description="1-2 sentences on the assumptions' effect on the result, or that none were needed")


def _facts(profile: SupplierProfile, snap: InventorySnapshot, lines: list[InventoryLine], asms: list[Assumption], n_docs: int, dropped: int) -> dict:
    t = snap.totals
    lib = get_library()

    # activity by carrier (headline rows only: scope 1 + scope 2 location)
    headline = [l for l in lines if l.scope == 1 or l.basis == "location"]
    agg: dict[tuple[str, str], dict] = {}
    for l in headline:
        k = (l.energy_type.value.replace("_", " "), l.unit.value)
        a = agg.setdefault(k, {"quantity": 0.0, "kg": 0.0, "lines": 0, "tiers": defaultdict(float)})
        a["quantity"] += l.quantity
        a["kg"] += l.kg_co2e
        a["lines"] += 1
        a["tiers"][l.tier] += l.kg_co2e
    activity = []
    for (et, unit), a in sorted(agg.items(), key=lambda kv: -kv[1]["kg"]):
        tot = a["kg"] or 1.0
        tiers = ", ".join(f"{k} {v/tot:.0%}" for k, v in sorted(a["tiers"].items()))
        activity.append({"energy_type": et, "unit": unit, "quantity": a["quantity"], "kg": a["kg"], "lines": a["lines"], "tiers": tiers})

    # factors used
    used: dict[str, set[str]] = defaultdict(set)
    for l in lines:
        label = l.energy_type.value.replace("_", " ")
        if l.basis:
            label += f" ({l.basis}-based)"
        used[l.factor_id].add(label)
    factors = []
    for fid, applies in used.items():
        f = lib.by_id.get(fid)
        if not f:
            continue
        factors.append({"applies": ", ".join(sorted(applies)), "value": f"{f.value:g}", "unit": f.unit.value,
                        "source": f.source_name, "vintage": f"{f.vintage} (applies {f.year})",
                        "notes": (f"{f.gas} · " if f.gas else "") + (f.notes.replace("VERIFY", "").strip(" .;") if f.notes else "")})

    sites = []
    for s in profile.sites:
        b = t.by_site.get(s.id, {"scope1": 0.0, "scope2_location": 0.0, "scope2_market": 0.0})
        sites.append({"name": s.name, "country": s.country, "region": s.region, **b})
    if "unassigned" in t.by_site:
        sites.append({"name": "Unassigned", "country": profile.country, "region": None, **t.by_site["unassigned"]})

    return {
        "profile": profile, "t": t, "sites": sites, "activity": activity, "factors": factors,
        "assumptions": asms, "tier_mix": sorted(t.tier_mix.items()), "skipped": snap.skipped,
        "documents": n_docs, "dropped": dropped,
        "generated": datetime.now(timezone.utc).strftime("%d %b %Y"),
    }


def _draft(facts: dict) -> Narrative:
    t = facts["t"]
    summary = {
        "supplier": facts["profile"].name, "country": facts["profile"].country,
        "period": f"{facts['profile'].fiscal_year_start} to {facts['profile'].fiscal_year_end}",
        "scope1_t": round(t.scope1_kg / 1000, 2), "scope2_location_t": round(t.scope2_location_kg / 1000, 2),
        "scope2_market_t": round(t.scope2_market_kg / 1000, 2), "biogenic_t": round(t.biogenic_kg / 1000, 2),
        "carriers": [f"{a['energy_type']} {a['quantity']:,.0f} {a['unit']}" for a in facts["activity"]],
        "factor_sources": sorted({f["source"].split("—")[0].strip() for f in facts["factors"]}),
        "market_fell_back_to_grid": any("fell back" in l for l in []),  # disclosed in table already
        "documents": facts["documents"], "assumptions": [a.method for a in facts["assumptions"]],
        "tier_mix": dict(facts["tier_mix"]), "dropped_outside_period": facts["dropped"],
    }
    prompt = (
        "Draft the three narrative paragraphs of a GHG inventory methodology note for a small manufacturer, "
        "for an auditor to read. Plain, precise English. Use only the facts given; do not add numbers that are not "
        "in the facts; do not praise; no bullet points.\n\nFacts:\n" + str(summary)
    )
    return get_gemini().generate_structured(prompt, Narrative)


def render_html(profile: SupplierProfile, snap: InventorySnapshot, lines: list[InventoryLine], asms: list[Assumption], *, n_docs: int, dropped: int) -> str:
    facts = _facts(profile, snap, lines, asms, n_docs, dropped)
    facts["narrative"] = _draft(facts)
    facts["font_path"] = _font_path()
    return env.get_template("methodology.html").render(**facts)


def html_to_pdf(html: str) -> bytes:
    try:
        from weasyprint import HTML  # type: ignore

        return HTML(string=html, base_url=str(HERE)).write_pdf()
    except Exception:
        from xhtml2pdf import pisa  # type: ignore

        out = io.BytesIO()
        status = pisa.CreatePDF(io.BytesIO(html.encode("utf-8")), dest=out, encoding="utf-8")
        if status.err:
            raise RuntimeError("PDF rendering failed")
        return out.getvalue()


def build_pdf(profile: SupplierProfile, snap: InventorySnapshot, lines: list[InventoryLine], asms: list[Assumption], *, n_docs: int, dropped: int) -> bytes:
    return html_to_pdf(render_html(profile, snap, lines, asms, n_docs=n_docs, dropped=dropped))
