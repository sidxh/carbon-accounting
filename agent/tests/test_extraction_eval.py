"""Golden-set extraction accuracy as a test.

Runs against the on-disk Gemini cache, so after one `scripts.eval_extraction`
run it is free and offline. Skipped when no API key is configured so the pure
tests stay runnable anywhere.
"""

import json
import mimetypes
from pathlib import Path

import pytest

from app.settings import get_settings

GOLDEN = Path(__file__).resolve().parents[2] / "data" / "golden"

pytestmark = pytest.mark.skipif(
    not get_settings().google_api_key and not get_settings().google_genai_use_vertexai,
    reason="no Gemini credentials configured",
)


@pytest.mark.slow
def test_golden_set_core_accuracy_at_least_90_percent():
    from app.agents.extractor import extract
    from scripts.eval_extraction import FIELDS, score_doc

    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    assert len(labels) >= 40
    rows = []
    for label in labels:
        path = GOLDEN / "rendered" / label["files"]["png"]
        got = extract(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png")
        rows.append(score_doc(label, got))

    core = ("quantity", "unit", "period_start", "period_end")
    acc = sum(sum(1 for r in rows if r.get(f)) for f in core) / (len(rows) * len(core))
    assert acc >= 0.90, f"core extraction accuracy {acc:.1%} below 90%"
    assert all(r.get("energy_type") for r in rows), "energy type misread on some documents"


@pytest.mark.slow
def test_golden_set_boxes_land_on_the_printed_value():
    """The box the extractor reports must overlap the printed figure (IoU >= 0.5)
    on at least 90% of the rendered bills; this is what "Show me where" draws."""
    from app.agents.extractor import extract
    from scripts.eval_extraction import score_box

    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    rows = []
    for label in labels:
        path = GOLDEN / "rendered" / label["files"]["png"]
        got = extract(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png")
        rows.append(score_box(label, got))
    boxed = [r for r in rows if "box" in r]
    assert len(boxed) >= 40
    hit = sum(1 for r in boxed if r["box"]) / len(boxed)
    assert hit >= 0.90, f"only {hit:.1%} of boxes land on the printed value"
