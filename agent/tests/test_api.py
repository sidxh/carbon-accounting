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


def test_unauthenticated_is_rejected_when_auth_enabled(monkeypatch):
    from app import settings as s
    s.get_settings.cache_clear()
    monkeypatch.setenv("AUTH_DISABLED", "FALSE")
    from app import main
    c = TestClient(main.app)
    assert c.get("/suppliers/x").status_code == 401
    s.get_settings.cache_clear()
