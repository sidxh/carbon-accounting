"""Validate the factor CSVs and, optionally, load them into Firestore.

    python data/factors/build.py              # validate only
    python data/factors/build.py --firestore  # validate and upsert to `factors/`

Run from the repo root with the agent venv on PATH (or `agent/.venv/bin/python`).
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agent"))

from app.factor_library import FactorLibrary  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--firestore", action="store_true", help="upsert into Firestore `factors`")
    args = ap.parse_args()

    lib = FactorLibrary.from_dir(Path(__file__).parent)
    by_country = Counter(f.country for f in lib.factors)
    verify = [f.id for f in lib.factors if "VERIFY" in f.notes.upper()]
    print(f"{len(lib.factors)} factors valid across {dict(by_country)}")
    if verify:
        print(f"{len(verify)} rows still marked VERIFY: {', '.join(verify)}")

    if args.firestore:
        from app.firebase import get_db

        db = get_db()
        batch = db.batch()
        for f in lib.factors:
            batch.set(db.collection("factors").document(f.id), f.model_dump(mode="json"))
        batch.commit()
        print(f"upserted {len(lib.factors)} factors to Firestore")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
