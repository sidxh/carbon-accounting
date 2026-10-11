"""The reconcile questions follow the app language; saving Setup keeps a site's located address."""

from app import main
from tests.test_api import PROFILE, _auth, _setup

URL = "/suppliers/sup-1"


def test_reconcile_uses_the_app_language_header(client, monkeypatch):
    pid = _setup(client)
    seen = []

    def fake(repo, profile, period, *a):
        seen.append(profile.language)
        return None

    monkeypatch.setattr(main.reconciler, "start", fake)
    monkeypatch.setattr(main.reconciler, "reply", fake)
    monkeypatch.setattr(main, "_reconcile_view", lambda *a: {})
    base = f"{URL}/periods/{pid}/reconcile"
    client.post(f"{base}/start", headers={**_auth(), "X-Locale": "ja"})
    client.post(base, json={"message": "hi"}, headers={**_auth(), "X-Locale": "en"})
    client.post(f"{base}/start", headers={**_auth(), "X-Locale": "xx"})     # unknown: the stored language
    client.post(f"{base}/start", headers=_auth())
    assert seen == ["ja", "en", "vi", "vi"]


def test_saving_setup_without_an_address_keeps_the_located_site(client):
    body = {**PROFILE, "name": "Minh Phát", "sites": [{"name": "Plant", "country": "VN", "address": "Lot B2, Long Hau"}]}
    p = client.post("/suppliers", json=body, headers=_auth()).json()
    sid = p["sites"][0]["id"]
    client.post(f"{URL}/sites/{sid}/locate", json={"lat": 10.7, "lng": 106.7}, headers=_auth())
    client.post(f"{URL}/sites/{sid}/locate", json={"roof_area_m2": 900}, headers=_auth())
    located = client.get(URL, headers=_auth()).json()["sites"][0]
    assert located["lat"] == 10.7

    # Setup no longer sends the address.
    again = {**body, "sites": [{"name": "Plant", "country": "VN", "region": "SE"}]}
    site = client.post("/suppliers", json=again, headers=_auth()).json()["sites"][0]
    assert site["address"] == "Lot B2, Long Hau"
    assert (site["lat"], site["lng"], site["roof_area_m2"]) == (10.7, 106.7, 900)
    # A different address, sent explicitly, drops the old lookup.
    moved = {**body, "sites": [{"name": "Plant", "country": "VN", "address": "Somewhere else"}]}
    site = client.post("/suppliers", json=moved, headers=_auth()).json()["sites"][0]
    assert site["address"] == "Somewhere else" and site["lat"] is None


def test_delete_year_removes_its_requests_files_and_nothing_else(client, tmp_path):
    from app import storage as st
    from app.repo import QuestionnaireRecord

    st._storage = st.LocalStorage(tmp_path)
    pid = _setup(client)
    a = client.post(f"{URL}/requests", json={"customer_name": "Aiko Corp", "period_id": pid}, headers=_auth()).json()["request"]
    other = client.post(f"{URL}/requests", json={"customer_name": "Old Buyer", "new_period": {"start": "2024-01-01", "end": "2024-12-31"}}, headers=_auth()).json()
    other_pid, other_rid = other["period"]["id"], other["request"]["id"]

    client.repo.put_questionnaire(QuestionnaireRecord(id="q1", supplier_id="sup-1", request_id=a["id"], period_id=pid, template_key="t", filled_key="f", status="filled"))
    client.repo.put_request("sup-1", client.repo.get_request("sup-1", a["id"]).model_copy(update={"questionnaire_id": "q1"}))
    for key in (f"suppliers/sup-1/periods/{pid}/uploads/d1/a.png", f"suppliers/sup-1/requests/{a['id']}/template.xlsx",
                f"suppliers/sup-1/periods/{other_pid}/uploads/d2/b.png"):
        st._storage.put(key, b"x")

    assert client.delete(f"{URL}/periods/{pid}", headers=_auth("sup-2")).status_code == 403
    assert client.delete(f"{URL}/periods/nope", headers=_auth()).status_code == 404
    assert client.delete(f"{URL}/periods/{pid}", headers=_auth()).status_code == 204

    assert client.repo.get_period("sup-1", pid) is None
    assert client.repo.get_request("sup-1", a["id"]) is None and client.repo.get_questionnaire("sup-1", "q1") is None
    assert not st._storage.exists(f"suppliers/sup-1/periods/{pid}/uploads/d1/a.png")
    assert not st._storage.exists(f"suppliers/sup-1/requests/{a['id']}/template.xlsx")
    # The other year and its request are untouched.
    assert client.repo.get_period("sup-1", other_pid) is not None and client.repo.get_request("sup-1", other_rid) is not None
    assert st._storage.exists(f"suppliers/sup-1/periods/{other_pid}/uploads/d2/b.png")
    assert client.get(f"{URL}/home", headers=_auth()).status_code == 200
