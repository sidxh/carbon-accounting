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
from app.models import Site, SupplierProfile
from app.repo import MemoryRepo, set_repo

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "data" / "golden"


def load_minh(repo: MemoryRepo, prefix: str = "vn_") -> SupplierProfile:
    profile = SupplierProfile(
        id="minh", name="Công ty TNHH Cơ khí Minh Phát", country="VN", language="vi",
        fiscal_year_start=date(2025, 1, 1), fiscal_year_end=date(2025, 12, 31),
        sites=[Site(id="nhon-trach", name="Xưởng Nhơn Trạch", country="VN")],
    )
    repo.put_supplier(profile)
    labels = [l for l in json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8")) if l["name"].startswith(prefix)]
    for label in labels:
        path = GOLDEN / "rendered" / label["files"]["png"]
        doc = extract(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png")
        lines = to_activity_lines(doc, supplier_id=profile.id, source_doc_id=label["name"], site_id="nhon-trach")
        repo.add_activity_lines(profile.id, lines)
    return profile


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--answer", default="Có, lò vẫn chạy bình thường như các tháng khác.")
    args = ap.parse_args()

    repo = MemoryRepo()
    set_repo(repo)
    profile = load_minh(repo)
    print(f"raw lines: {len(repo.list_activity_lines(profile.id))}")

    state = reconciler.start(repo, profile)
    print(f"\nafter prepare: {len(repo.list_activity_lines(profile.id))} lines, "
          f"{len(state.issues)} issues -> {[ (i['kind'], i.get('months')) for i in state.issues ]}")
    print(f"status={state.status}\nAGENT: {state.history[-1].text}")

    turns = 0
    while state.status == "asking" and turns < 4:
        print(f"USER : {args.answer}")
        state = reconciler.reply(repo, profile, args.answer)
        for t in state.history[-2:]:
            if t.role == "agent":
                print(f"AGENT: {t.text}")
        turns += 1

    print(f"\nstatus={state.status}")
    asms = repo.list_assumptions(profile.id)
    print(f"assumptions: {[(a.method, len(a.applied_to)) for a in asms]}")
    est = [l for l in repo.list_activity_lines(profile.id) if l.tier == "estimated"]
    print(f"estimated lines: {[(l.energy_type.value, l.period_start.isoformat(), round(l.quantity)) for l in est]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
