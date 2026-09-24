"""API contract tests against the in-memory repo with auth disabled.

Model calls are avoided (no upload/reconcile here) so this runs offline; the
Gemini-backed paths are covered by the scripted demo and the golden eval.
"""

import io
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.models import ActivityLine, EnergyType, Unit
from app.repo import MemoryRepo, set_repo


@pytest.fixture
def client(monkeypatch):
    from app import settings as s

    s.get_settings.cache_clear()
    monkeypatch.setenv("AUTH_DISABLED", "TRUE")
    monkeypatch.setenv("STORAGE_BACKEND", "memory")
    from app import main

    repo = MemoryRepo()
    set_repo(repo)
    # storage: swap in a fresh local dir under the test tmp
    from app import storage as st
    st._storage = None
    c = TestClient(main.app)
    c.repo = repo
    yield c
    s.get_settings.cache_clear()


def _auth(uid="sup-1"):
    return {"Authorization": f"Bearer {uid}"}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_supplier_upsert_and_ownership(client):
    body = {"name": "Minh Phát", "country": "vn", "language": "vi",
            "fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31",
            "sites": [{"name": "Nhơn Trạch", "country": "VN"}]}
    r = client.post("/suppliers", json=body, headers=_auth())
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == "sup-1" and p["country"] == "VN" and len(p["sites"]) == 1

    assert client.get("/suppliers/sup-1", headers=_auth()).status_code == 200
    # Another caller cannot read it.
    assert client.get("/suppliers/sup-1", headers=_auth("sup-2")).status_code == 403


def test_inventory_requires_compute_and_compute_writes_lineage(client):
    client.post("/suppliers", json={"fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31", "country": "VN"}, headers=_auth())
    client.repo.add_activity_lines("sup-1", [
        ActivityLine(id="a1", supplier_id="sup-1", source_doc_id="doc-1", site_id="main", energy_type=EnergyType.ELECTRICITY,
                     quantity=10_000, unit=Unit.KWH, period_start=date(2025, 1, 1), period_end=date(2025, 1, 31)),
        ActivityLine(id="a2", supplier_id="sup-1", source_doc_id="doc-2", site_id="main", energy_type=EnergyType.DIESEL,
                     quantity=1000, unit=Unit.LITRE, period_start=date(2025, 2, 1), period_end=date(2025, 2, 1)),
    ])
    r = client.post("/suppliers/sup-1/compute", headers=_auth())
    assert r.status_code == 200
    t = r.json()["totals"]
    assert t["scope1_kg"] == pytest.approx(2660) and t["scope2_location_kg"] == pytest.approx(6592, rel=1e-3)

    inv = client.get("/suppliers/sup-1/inventory", headers=_auth()).json()
    assert len(inv["lines"]) == 3  # diesel + electricity location + electricity market
    for l in inv["lines"]:
        assert l["source_doc_id"] and l["factor_id"] and l["factor_citation"]


def test_patch_line_marks_secondary_and_recomputes(client):
    client.post("/suppliers", json={"fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31", "country": "VN"}, headers=_auth())
    client.repo.add_activity_lines("sup-1", [
        ActivityLine(id="a2", supplier_id="sup-1", source_doc_id="doc-2", site_id="main", energy_type=EnergyType.DIESEL,
                     quantity=1000, unit=Unit.LITRE, period_start=date(2025, 2, 1), period_end=date(2025, 2, 1)),
    ])
    client.post("/suppliers/sup-1/compute", headers=_auth())
    r = client.patch("/suppliers/sup-1/activity-lines/a2", json={"quantity": 1200}, headers=_auth())
    assert r.status_code == 200
    assert r.json()["snapshot"]["totals"]["scope1_kg"] == pytest.approx(1200 * 2.66)
    line = client.repo.list_activity_lines("sup-1")[0]
    assert line.tier == "secondary" and "corrected by supplier" in line.notes


def test_questionnaire_and_methodology_need_inventory_first(client):
    client.post("/suppliers", json={"fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31", "country": "VN"}, headers=_auth())
    r = client.post("/suppliers/sup-1/questionnaire", files={"file": ("q.xlsx", io.BytesIO(b"x"), "application/octet-stream")}, headers=_auth())
    assert r.status_code == 409
    assert client.get("/suppliers/sup-1/methodology", headers=_auth()).status_code == 409


def _seed_reconciled_supplier(client):
    """A supplier that has uploaded one bill, answered a gap question, and computed."""
    from app.models import Assumption
    from app.repo import DocumentRecord, ReconcileState

    client.post("/suppliers", json={"fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31", "country": "VN"}, headers=_auth())
    extraction = {
        "doc_type": "electricity_bill", "language": "vi", "vendor": "EVN", "customer": None, "site_hint": None,
        "currency": "VND", "total_amount": 1.0, "confidence": 1.0, "warnings": [],
        "lines": [{"energy_type": "electricity", "quantity": 10000, "unit": "kWh", "period_start": "2025-01-01",
                   "period_end": "2025-01-31", "gas": None, "confidence": 1.0, "evidence": "10,000 kWh"}],
    }
    client.repo.put_document(DocumentRecord(id="doc-1", supplier_id="sup-1", storage_key="suppliers/sup-1/uploads/doc-1/a.png",
                                            filename="a.png", mime_type="image/png", site_id="main", status="extracted",
                                            extraction=extraction))
    client.repo.add_activity_lines("sup-1", [
        # the extracted line, corrected by the supplier in the inventory view
        ActivityLine(id="a1", supplier_id="sup-1", source_doc_id="doc-1", site_id="main", energy_type=EnergyType.ELECTRICITY,
                     quantity=12000, unit=Unit.KWH, period_start=date(2025, 1, 1), period_end=date(2025, 1, 31),
                     tier="secondary", notes="corrected by supplier from 10000 to 12000"),
        # an estimated month from a chat answer
        ActivityLine(id="a2", supplier_id="sup-1", source_doc_id="assumption:asm-1", site_id="main",
                     energy_type=EnergyType.ELECTRICITY, quantity=10000, unit=Unit.KWH, period_start=date(2025, 2, 1),
                     period_end=date(2025, 2, 28), tier="estimated", assumption_ids=["asm-1"]),
    ])
    client.repo.add_assumption("sup-1", Assumption(id="asm-1", supplier_id="sup-1", question="q", answer="a", applied_to=["a2"], method="m"))
    client.repo.put_reconcile(ReconcileState(supplier_id="sup-1", status="done"))
    client.post("/suppliers/sup-1/compute", headers=_auth())
    assert client.get("/suppliers/sup-1/inventory", headers=_auth()).json()["snapshot"] is not None


def test_reset_chat_rebuilds_lines_from_extraction_and_keeps_documents(client):
    _seed_reconciled_supplier(client)
    r = client.delete("/suppliers/sup-1/data?scope=chat", headers=_auth())
    assert r.status_code == 200 and r.json()["activity_lines"] == 1

    lines = client.repo.list_activity_lines("sup-1")
    assert len(lines) == 1
    assert lines[0].source_doc_id == "doc-1" and lines[0].quantity == 10000 and lines[0].tier == "primary"
    assert client.repo.list_assumptions("sup-1") == []
    assert client.get("/suppliers/sup-1/reconcile", headers=_auth()).json() is None
    inv = client.get("/suppliers/sup-1/inventory", headers=_auth()).json()
    assert inv["snapshot"] is None and inv["lines"] == []
    assert len(client.get("/suppliers/sup-1/documents", headers=_auth()).json()["documents"]) == 1
    assert client.get("/suppliers/sup-1", headers=_auth()).status_code == 200


def test_delete_document_removes_lines_and_resets_inventory(client, tmp_path):
    from app import storage as st

    st._storage = st.LocalStorage(tmp_path)
    _seed_reconciled_supplier(client)
    st._storage.put("suppliers/sup-1/uploads/doc-1/a.png", b"png")
    assert client.get("/suppliers/sup-1/inventory", headers=_auth()).json()["snapshot"] is not None

    r = client.delete("/suppliers/sup-1/documents/doc-1", headers=_auth())
    assert r.status_code == 204
    assert client.get("/suppliers/sup-1/documents", headers=_auth()).json()["documents"] == []
    # The bill's own line is gone; the estimated line from the chat answer stays.
    ids = {l.source_doc_id for l in client.repo.list_activity_lines("sup-1")}
    assert ids == {"assumption:asm-1"}
    assert not st._storage.exists("suppliers/sup-1/uploads/doc-1/a.png")
    assert client.get("/suppliers/sup-1/inventory", headers=_auth()).json()["snapshot"] is None
    assert client.get("/suppliers/sup-1/reconcile", headers=_auth()).json()["status"] == "idle"
    assert client.delete("/suppliers/sup-1/documents/doc-1", headers=_auth()).status_code == 404
    assert client.delete("/suppliers/sup-1/documents/doc-1", headers=_auth("sup-2")).status_code == 403


def test_reset_all_keeps_only_profile(client):
    _seed_reconciled_supplier(client)
    r = client.delete("/suppliers/sup-1/data?scope=all", headers=_auth())
    assert r.status_code == 200
    assert client.get("/suppliers/sup-1/documents", headers=_auth()).json()["documents"] == []
    assert client.repo.list_activity_lines("sup-1") == []
    assert client.get("/suppliers/sup-1/inventory", headers=_auth()).json()["snapshot"] is None
    assert client.get("/suppliers/sup-1", headers=_auth()).status_code == 200
    # Another supplier cannot reset it; an unknown scope is rejected.
    assert client.delete("/suppliers/sup-1/data", headers=_auth("sup-2")).status_code == 403
    assert client.delete("/suppliers/sup-1/data?scope=everything", headers=_auth()).status_code == 400


def test_edit_answer_rewrites_workbook_and_locks_calculator_numbers(client, tmp_path):
    from openpyxl import Workbook, load_workbook

    from app.agents.filler import Answer
    from app.repo import QuestionnaireRecord
    from app import storage as st

    st._storage = st.LocalStorage(tmp_path)
    client.post("/suppliers", json={"fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31", "country": "VN"}, headers=_auth())

    wb = Workbook(); ws = wb.active; ws.title = "Q"
    ws.append(["Ref", "Question", "Response", "Notes"])
    ws.append(["20.4", "Scope 1 emissions (tCO2e)", None, None])
    ws.append(["20.16", "Do you have a reduction target?", None, None])
    buf = io.BytesIO(); wb.save(buf)
    st._storage.put("suppliers/sup-1/questionnaires/q1/template.xlsx", buf.getvalue())

    answers = [
        Answer(question_id="q1", ref="20.4", question="Scope 1 emissions (tCO2e)", field="scope1_tco2e", value=12.5,
               source="calculator", sheet="Q", row=2, col=2, editable=False),
        Answer(question_id="q2", ref="20.16", question="Do you have a reduction target?", field="reduction_target",
               value=None, source="-", flagged=True, flag_reason="to be stated by the supplier", sheet="Q", row=3, col=2),
    ]
    rec = QuestionnaireRecord(id="q1", supplier_id="sup-1", template_key="suppliers/sup-1/questionnaires/q1/template.xlsx",
                              filled_key="suppliers/sup-1/outputs/q1/filled.xlsx", answers=[a.model_dump() for a in answers],
                              status="filled")
    client.repo.put_questionnaire(rec)

    # Calculator number: refused.
    r = client.patch("/suppliers/sup-1/questionnaire/q1/answers/q1", json={"value": "999"}, headers=_auth())
    assert r.status_code == 400 and "inventory" in r.json()["detail"]

    # Flagged text: accepted, unflagged, written to the workbook in blue with provenance.
    r = client.patch("/suppliers/sup-1/questionnaire/q1/answers/q2", json={"value": "Cut Scope 2 by 30% by 2030 via rooftop solar."}, headers=_auth())
    assert r.status_code == 200
    a = next(x for x in r.json()["questionnaire"]["answers"] if x["question_id"] == "q2")
    assert a["flagged"] is False and a["edited"] is True and a["source"] == "entered by supplier"

    out = load_workbook(io.BytesIO(st._storage.get("suppliers/sup-1/outputs/q1/filled.xlsx")))["Q"]
    assert out["C3"].value.startswith("Cut Scope 2") and out["C3"].fill.fgColor.rgb.endswith("DCEBFA")
    assert out["C3"].comment.text == "Source: entered by supplier"
    assert out["C2"].value == 12.5  # the locked number is still written from the stored answer

    # Second edit records what it replaced; empty and unknown are rejected.
    r = client.patch("/suppliers/sup-1/questionnaire/q1/answers/q2", json={"value": "Net zero by 2040."}, headers=_auth())
    assert "generated answer was" not in r.json()["questionnaire"]["answers"][1]["source"]  # a supplier edit replaced a supplier edit
    assert client.patch("/suppliers/sup-1/questionnaire/q1/answers/q2", json={"value": "  "}, headers=_auth()).status_code == 400
    assert client.patch("/suppliers/sup-1/questionnaire/q1/answers/zz", json={"value": "x"}, headers=_auth()).status_code == 404
    assert client.patch("/suppliers/sup-1/questionnaire/q1/answers/q2", json={"value": "x"}, headers=_auth("sup-2")).status_code == 403


def test_unauthenticated_is_rejected_when_auth_enabled(monkeypatch):
    from app import settings as s
    s.get_settings.cache_clear()
    monkeypatch.setenv("AUTH_DISABLED", "FALSE")
    from app import main
    c = TestClient(main.app)
    assert c.get("/suppliers/x").status_code == 401
    s.get_settings.cache_clear()
