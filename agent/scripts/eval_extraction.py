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
import time
from datetime import date
from pathlib import Path

from app.agents.extractor import extract

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "data" / "golden"

FIELDS = ("energy_type", "quantity", "unit", "period_start", "period_end", "gas")


def _close(a: float, b: float, tol: float = 0.01) -> bool:
    return abs(a - b) <= max(tol * abs(b), 0.5)


def iou(a: list[int], b: list[int]) -> float:
    """Intersection over union of two [ymin, xmin, ymax, xmax] boxes."""
    y0, x0, y1, x1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, y1 - y0) * max(0, x1 - x0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0


BOX_HIT = 0.5  # IoU at which the box counts as showing the right value


def score_box(label: dict, got, kind: str = "png") -> dict:
    """Did the reported box land on the printed quantity? Scored on images only:
    the ground-truth boxes come from the rendered PNG layout."""
    gt = label["lines"][0].get("box")
    if kind != "png" or not gt:
        return {}
    cand = next((l for l in got.lines if l.energy_type == label["lines"][0]["energy_type"]), got.lines[0] if got.lines else None)
    pred = getattr(cand, "quantity_box", None) if cand else None
    if not pred or len(pred) != 4:
        return {"box": False, "box_iou": 0.0}
    v = iou(pred, gt)
    return {"box": v >= BOX_HIT, "box_iou": round(v, 3)}


COUNTRY_BY_CURRENCY = {"VND": "VN", "JPY": "JP", "AUD": "AU"}


def score_checks(label: dict, got) -> dict:
    """Do the bill's self-checks behave? A clean bill must raise none (a false alarm
    costs the supplier a question); a bill with a planted misread must fail the
    checks the label names. Index needs meter registers and price needs the bill's
    amount, so both are exercised by the real extraction rather than by the label."""
    from app.agents.extractor import to_activity_lines

    lines = to_activity_lines(got, supplier_id="eval", source_doc_id=label["name"], site_id=None,
                              country=COUNTRY_BY_CURRENCY.get(label.get("currency") or ""))
    status = {c.id: c.status for l in lines for c in l.checks}
    expect = label.get("expect_checks")
    if expect:
        return {"check_planted": True, "check_ok": all(status.get(k) == v for k, v in expect.items()), "checks": status}
    return {"check_planted": False, "check_ok": "fail" not in status.values(), "checks": status}


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


def extract_patiently(data: bytes, mime: str, tries: int = 4):
    """`extract`, waiting out the free tier's "high demand" 503s so one busy minute does not end a long run."""
    for i in range(tries):
        try:
            return extract(data, mime)
        except Exception as exc:  # noqa: BLE001 - only transient service errors are retried
            if i == tries - 1 or "503" not in str(exc) and "429" not in str(exc):
                raise
            time.sleep(25 * (i + 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--pdf", action="store_true")
    ap.add_argument("--filter", help="substring on document name")
    ap.add_argument("--pack", action="store_true", help="score the Japanese sample pack (labels_pack.json) instead of the golden set")
    args = ap.parse_args()

    labels = json.loads((GOLDEN / ("labels_pack.json" if args.pack else "labels.json")).read_text(encoding="utf-8"))
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
            got = extract_patiently(path.read_bytes(), mime)
            s = score_doc(label, got) | score_box(label, got, kind) | score_checks(label, got)
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
    boxed = [r for r in rows if "box" in r]
    if boxed:
        hit = sum(1 for r in boxed if r["box"]) / len(boxed)
        mean = sum(r["box_iou"] for r in boxed) / len(boxed)
        print(f"  box on printed value (IoU >= {BOX_HIT}): {hit:6.1%}   mean IoU {mean:.2f}   ({len(boxed)} images)")
    clean = [r for r in rows if r.get("check_planted") is False]
    planted = [r for r in rows if r.get("check_planted")]
    if clean:
        print(f"  self-checks raise no false alarm on clean bills: {sum(1 for r in clean if r['check_ok'])}/{len(clean)}")
    if planted:
        print(f"  self-checks catch the planted misread: {sum(1 for r in planted if r['check_ok'])}/{len(planted)}")
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
