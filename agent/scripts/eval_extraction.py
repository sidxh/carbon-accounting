"""Score the extractor against the golden set.

    .venv/bin/python -m scripts.eval_extraction            # all documents
    .venv/bin/python -m scripts.eval_extraction --limit 8  # quick look
    .venv/bin/python -m scripts.eval_extraction --pdf      # score the PDF variants too

Responses are cached by the Gemini client, so a second run is free and
deterministic. Prints field-level accuracy and writes eval_report.json.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
from datetime import date
from pathlib import Path

from app.agents.extractor import extract

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "data" / "golden"

FIELDS = ("energy_type", "quantity", "unit", "period_start", "period_end", "gas")


def _close(a: float, b: float, tol: float = 0.01) -> bool:
    return abs(a - b) <= max(tol * abs(b), 0.5)


def score_doc(label: dict, got) -> dict:
    exp = label["lines"][0]
    if not got.lines:
        return {f: False for f in FIELDS} | {"found_line": False}
    # Best-matching line by energy type, else the first.
    cand = next((l for l in got.lines if l.energy_type == exp["energy_type"]), got.lines[0])
    res = {
        "found_line": True,
        "energy_type": cand.energy_type == exp["energy_type"],
        "quantity": _close(cand.quantity, exp["quantity"]),
        "unit": cand.unit == exp["unit"],
        "period_start": cand.period_start[:10] == exp["period_start"],
        "period_end": cand.period_end[:10] == exp["period_end"],
        "gas": ((cand.gas or "").upper().replace(" ", "") == (exp["gas"] or "").upper().replace(" ", "")),
    }
    res["all"] = all(res[f] for f in FIELDS)
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--pdf", action="store_true")
    ap.add_argument("--filter", help="substring on document name")
    args = ap.parse_args()

    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    if args.filter:
        labels = [l for l in labels if args.filter in l["name"]]
    if args.limit:
        labels = labels[: args.limit]

    rows = []
    for label in labels:
        variants = [("png", label["files"]["png"])]
        if args.pdf and "pdf" in label["files"]:
            variants.append(("pdf", label["files"]["pdf"]))
        for kind, fname in variants:
            path = GOLDEN / "rendered" / fname
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            got = extract(path.read_bytes(), mime)
            s = score_doc(label, got)
            rows.append({"name": label["name"], "kind": kind, "lang": label["lang"], **s,
                         "got": got.model_dump(), "expected": label["lines"][0]})
            mark = "ok " if s.get("all") else "BAD"
            miss = [f for f in FIELDS if not s.get(f)]
            print(f"{mark} {label['name']:28s} {kind}  {'' if not miss else 'missed: ' + ', '.join(miss)}")

    n = len(rows)
    print(f"\n{n} documents scored")
    for f in FIELDS + ("all",):
        acc = sum(1 for r in rows if r.get(f)) / n if n else 0
        print(f"  {f:13s} {acc:6.1%}")
    by_lang = {}
    for r in rows:
        by_lang.setdefault(r["lang"], []).append(r["all"])
    for lang, v in sorted(by_lang.items()):
        print(f"  [{lang}] exact-all {sum(v)/len(v):.1%} ({len(v)})")

    (ROOT / "agent" / "eval_report.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False, default=str))
    core = [f for f in ("quantity", "unit", "period_start", "period_end")]
    core_acc = sum(sum(1 for r in rows if r.get(f)) for f in core) / (n * len(core)) if n else 0
    print(f"\ncore accuracy (quantity/unit/period): {core_acc:.1%}  target ≥ 90%")
    return 0 if core_acc >= 0.9 else 1


if __name__ == "__main__":
    raise SystemExit(main())
