"""Drive the reconciler end to end on the golden Vietnamese set, in memory.

    .venv/bin/python -m scripts.demo_reconcile
    .venv/bin/python -m scripts.demo_reconcile --answer "Không, lò nghỉ bảo trì"

Extraction is served from the Gemini cache after the eval has run, so this
costs only the reconciler's own calls (about four).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
from datetime import date
from pathlib import Path

from app.agents import reconciler
from app.agents.extractor import extract, to_activity_lines
from app.models import ReportingPeriod, Site, SupplierProfile
from app.repo import MemoryRepo, set_repo

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "data" / "golden"


def load_minh(repo: MemoryRepo, prefix: str = "vn_") -> tuple[SupplierProfile, ReportingPeriod]:
    profile = SupplierProfile(
        id="minh", name="Công ty TNHH Cơ khí Minh Phát", country="VN", language="vi",
        fiscal_year_start=date(2025, 1, 1), fiscal_year_end=date(2025, 12, 31),
        sites=[Site(id="nhon-trach", name="Xưởng Nhơn Trạch", country="VN")],
    )
    repo.put_supplier(profile)
    period = ReportingPeriod(id="fy2025", label="FY2025", start=profile.fiscal_year_start, end=profile.fiscal_year_end)
    repo.put_period(profile.id, period)
    labels = [l for l in json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8")) if l["name"].startswith(prefix)]
    for label in labels:
        path = GOLDEN / "rendered" / label["files"]["png"]
        doc = extract(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png")
        lines = to_activity_lines(doc, supplier_id=profile.id, source_doc_id=label["name"], site_id="nhon-trach")
        repo.add_activity_lines(profile.id, period.id, lines)
    return profile, period


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--answer", default="Có, lò vẫn chạy bình thường như các tháng khác.")
    args = ap.parse_args()

    repo = MemoryRepo()
    set_repo(repo)
    profile, period = load_minh(repo)
    print(f"raw lines: {len(repo.list_activity_lines(profile.id, period.id))}")

    state = reconciler.start(repo, profile, period)
    print(f"\nafter prepare: {len(repo.list_activity_lines(profile.id, period.id))} lines, "
          f"{len(state.issues)} issues -> {[ (i['kind'], i.get('months')) for i in state.issues ]}")
    print(f"status={state.status}\nAGENT: {state.history[-1].text}")

    turns = 0
    while state.status == "asking" and turns < 4:
        print(f"USER : {args.answer}")
        state = reconciler.reply(repo, profile, period, args.answer)
        for t in state.history[-2:]:
            if t.role == "agent":
                print(f"AGENT: {t.text}")
        turns += 1

    print(f"\nstatus={state.status}")
    asms = repo.list_assumptions(profile.id, period.id)
    print(f"assumptions: {[(a.method, len(a.applied_to)) for a in asms]}")
    est = [l for l in repo.list_activity_lines(profile.id, period.id) if l.tier == "estimated"]
    print(f"estimated lines: {[(l.energy_type.value, l.period_start.isoformat(), round(l.quantity)) for l in est]}")

    from app.services import compute_inventory

    snap = compute_inventory(repo, profile, period)
    t = snap.totals
    print(f"\nINVENTORY FY{snap.reporting_year}")
    print(f"  Scope 1                {t.scope1_kg/1000:10.2f} tCO2e")
    print(f"  Scope 2 location-based {t.scope2_location_kg/1000:10.2f} tCO2e")
    print(f"  Scope 2 market-based   {t.scope2_market_kg/1000:10.2f} tCO2e")
    print(f"  biogenic (outside)     {t.biogenic_kg/1000:10.2f} tCO2")
    print(f"  by type: {{ {', '.join(f'{k}: {v/1000:.2f} t' for k, v in t.by_energy_type.items())} }}")
    print(f"  tier mix: {{ {', '.join(f'{k}: {v:.1%}' for k, v in t.tier_mix.items())} }}")
    print(f"  skipped: {snap.skipped}")
    inv, _ = repo.list_inventory(profile.id, period.id)
    sample = next(l for l in inv if l.energy_type.value == "refrigerant")
    print(f"\nsample lineage — {sample.id}: {sample.quantity:g} {sample.unit} × {sample.factor_value} = {sample.kg_co2e:.0f} kg")
    print(f"  doc={sample.source_doc_id} factor={sample.factor_id} tier={sample.tier}\n  {sample.factor_citation}")

    from app.agents.filler import fill_workbook

    template = (ROOT / "data" / "templates" / "cdp_sme_questionnaire.xlsx").read_bytes()
    filled, answers, _offset = fill_workbook(
        template, profile=profile, snap=snap, lines=inv, assumptions=asms, customer_share=0.20
    )
    out = ROOT / "agent" / ".local_storage" / "demo_filled_cdp_sme.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(filled)
    print(f"\nQUESTIONNAIRE — {len(answers)} answers written to {out.relative_to(ROOT)}")
    for a in answers:
        v = a.value if not isinstance(a.value, str) else (a.value[:70] + "…" if len(a.value) > 70 else a.value)
        print(f"  {'⚑' if a.flagged else ' '} {a.ref or '-':8s} {a.field:24s} {v}")

    from app.exporters.methodology import build_pdf

    pdf = build_pdf(profile, snap, inv, asms, n_docs=30, dropped=len(state.dropped_outside_fy))
    pdf_path = out.with_name("demo_methodology_note.pdf")
    pdf_path.write_bytes(pdf)
    print(f"\nMETHODOLOGY NOTE — {len(pdf):,} bytes → {pdf_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
