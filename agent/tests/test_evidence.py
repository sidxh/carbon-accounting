"""Provenance: boxes are cleaned, pages render, crops outline the value, and the
API serves a bill page the browser can draw a box over. Offline, no model."""

import io
import tempfile
from datetime import date
from pathlib import Path

import pytest
from PIL import Image

from app.agents.extractor import ExtractedDocument, ExtractedLine, _clean_box, to_activity_lines
from app.evidence import crop_evidence, page_count, page_png, render_page


def _png(w=600, h=800, color=(250, 250, 250)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), color).save(out, format="PNG")
    return out.getvalue()


def _pdf(pages=2) -> bytes:
    imgs = [Image.new("RGB", (595, 842), (255, 255, 255)) for _ in range(pages)]
    out = io.BytesIO()
    imgs[0].save(out, format="PDF", save_all=True, append_images=imgs[1:])
    return out.getvalue()


def test_clean_box_clamps_and_rejects_non_rectangles():
    assert _clean_box([392, 700, 417, 883]) == [392, 700, 417, 883]
    assert _clean_box([-20, 5, 1200, 990]) == [0, 5, 1000, 990]
    assert _clean_box([400, 700, 400, 883]) is None      # zero height
    assert _clean_box([500, 900, 600, 100]) is None      # flipped
    assert _clean_box([1, 2, 3]) is None and _clean_box(None) is None and _clean_box([]) is None


def test_extracted_box_page_and_registers_reach_the_activity_line():
    doc = ExtractedDocument(
        doc_type="electricity_bill", language="vi", confidence=0.9,
        lines=[ExtractedLine(energy_type="electricity", quantity=100, unit="kWh", period_start="2025-01-01",
                             period_end="2025-01-31", confidence=0.9, evidence="Tổng 100 kWh",
                             quantity_box=[392, 775, 411, 874], page=0,
                             registers=[{"label": "bt", "previous": 10, "current": 110, "multiplier": 1}])],
    )
    (ln,) = to_activity_lines(doc, supplier_id="s", source_doc_id="d", site_id=None)
    assert ln.quantity_box == [392, 775, 411, 874]
    assert ln.page == 1                                   # never below 1
    assert ln.registers[0].current == 110


def test_render_page_photo_and_pdf():
    assert render_page(_png(), "image/png").size == (600, 800)
    big = render_page(_png(4000, 3000), "image/png")
    assert max(big.size) <= 1800
    pdf = _pdf(2)
    assert page_count(pdf, "application/pdf") == 2 and page_count(_png(), "image/png") == 1
    p1, p2 = render_page(pdf, "application/pdf", 1), render_page(pdf, "application/pdf", 2)
    assert p1.size == p2.size and p1.size[1] > p1.size[0]
    assert render_page(pdf, "application/pdf", 99).size == p2.size   # clamped to the last page
    assert page_png(pdf, "application/pdf", 1).startswith(b"\x89PNG")


def test_crop_outlines_the_printed_value_in_red():
    data = _png(1000, 1400)
    crop = Image.open(io.BytesIO(crop_evidence(data, "image/png", 1, [500, 600, 520, 900], width=420))).convert("RGB")
    assert crop.size[0] <= 420
    raw = crop.tobytes()
    reds = sum(1 for i in range(0, len(raw), 3) if raw[i] > 200 and raw[i + 1] < 80 and raw[i + 2] < 110)
    assert reds > 40


def _seed_doc(client, png: bytes, box):
    from app import storage as st
    from app.models import ActivityLine, EnergyType, Unit
    from app.repo import DocumentRecord

    st._storage = st.LocalStorage(Path(tempfile.mkdtemp()))
    client.post("/suppliers", json={"fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31", "country": "VN"},
                headers={"Authorization": "Bearer sup-1"})
    pid = client.get("/suppliers/sup-1/periods", headers={"Authorization": "Bearer sup-1"}).json()["periods"][0]["id"]
    key = f"suppliers/sup-1/periods/{pid}/uploads/doc-1/a.png"
    st._storage.put(key, png, "image/png")
    client.repo.put_document(DocumentRecord(id="doc-1", supplier_id="sup-1", period_id=pid, storage_key=key,
                                            filename="a.png", mime_type="image/png", status="extracted"))
    client.repo.add_activity_lines("sup-1", pid, [ActivityLine(
        id="a1", supplier_id="sup-1", source_doc_id="doc-1", energy_type=EnergyType.ELECTRICITY, quantity=1000,
        unit=Unit.KWH, period_start=date(2025, 1, 1), period_end=date(2025, 1, 31), quantity_box=box)])
    return pid


def test_page_endpoint_serves_png_and_is_owner_only(client):
    pid = _seed_doc(client, _png(), [100, 100, 130, 300])
    r = client.get(f"/suppliers/sup-1/periods/{pid}/documents/doc-1/page/1", headers={"Authorization": "Bearer sup-1"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")
    assert client.get(f"/suppliers/sup-1/periods/{pid}/documents/nope/page/1", headers={"Authorization": "Bearer sup-1"}).status_code == 404
    assert client.get(f"/suppliers/sup-1/periods/{pid}/documents/doc-1/page/1", headers={"Authorization": "Bearer sup-2"}).status_code == 403


def test_methodology_evidence_crops_only_lines_with_a_known_box(client):
    from app.services import build_evidence

    pid = _seed_doc(client, _png(1000, 1400), [500, 600, 520, 900])
    client.post(f"/suppliers/sup-1/periods/{pid}/compute", headers={"Authorization": "Bearer sup-1"})
    lines, _ = client.repo.list_inventory("sup-1", pid)
    ev = build_evidence(client.repo, "sup-1", pid, lines)
    assert len(ev) == 1 and ev[0]["carrier"] == "electricity" and ev[0]["filename"] == "a.png" and len(ev[0]["png"]) > 100

    # A line read before positions were recorded has no snippet, and nothing breaks.
    acts = client.repo.list_activity_lines("sup-1", pid)
    client.repo.replace_activity_lines("sup-1", pid, [a.model_copy(update={"quantity_box": None}) for a in acts])
    assert build_evidence(client.repo, "sup-1", pid, lines) == []
