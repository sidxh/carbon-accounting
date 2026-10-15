"""The reduction plan as a PDF: what the supplier saw in "Where you could cut emissions", to keep or hand on.

Everything in it comes from the advisor's own output; no model call is made, so it costs no quota and the
numbers are exactly the ones on screen. `picked` is the set of options the supplier ticked, so the before and
after figures match the screen too.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..advisor import Advice, scenario
from ..models import Site, SupplierProfile
from .methodology import _font_path, env, html_to_pdf

DISCLAIMER = "These are estimates to help you decide, not commitments. Get a quote before you invest."


def _t(kg: float, digits: int = 1) -> str:
    return f"{kg / 1000:,.{digits}f}"


def render_html(profile: SupplierProfile, site: Site | None, advice: Advice, picked: set[str]) -> str:
    sc = scenario(advice, picked)
    solar = advice.solar
    levers = []
    for l in advice.levers:
        spread = l.saved_max_kg - l.saved_min_kg > 50
        levers.append({
            "name": l.name,
            "picked": l.id in picked and l.beneficial,
            "range": f"{_t(l.saved_min_kg)}-{_t(l.saved_max_kg)}" if spread else _t(l.saved_mid_kg),
            "worse": not l.beneficial,
            "worse_by": _t(-l.saved_mid_kg),
            "market": l.basis == "market",
            "cost": l.cost_class,
            "cost_note": l.cost_note,
            "note": l.note,
            "source_name": l.source_name,
            "source_url": l.source_url,
        })
    return env.get_template("recommendations.html").render(
        profile=profile, site=site, advice=advice, solar=solar, levers=levers, sc=sc, t=_t,
        solar_picked="solar" in picked and solar.available,
        generated=datetime.now(timezone.utc).strftime("%d %b %Y"),
        font_path=_font_path(), disclaimer=DISCLAIMER,
        pct=round(sc.saved_kg / sc.base_kg * 100) if sc.base_kg > 0 else 0,
    )


def build_pdf(profile: SupplierProfile, site: Site | None, advice: Advice, picked: set[str]) -> bytes:
    return html_to_pdf(render_html(profile, site, advice, picked))
