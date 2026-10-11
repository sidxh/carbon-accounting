"""Locate and advisor endpoints, with Google and PVGIS replaced by stubs. Offline."""

import json
from datetime import date
from pathlib import Path

import pytest

from app import solar
from app.agents.filler import _draft_reductions
from app.advisor import advise
from app.models import ActivityLine, EnergyType, Unit
from app.solar import Building, Place, RoofConfig
from tests.test_advisor import VN
from tests.test_api import PROFILE, _auth, _lines, _setup

FIX = Path(__file__).parent / "fixtures"
URL = "/suppliers/sup-1"


def building() -> Building:
    d = json.loads((FIX / "solar_kariya.json").read_text())["solarPotential"]
    return Building(68, 133.0, 305.0, 400.0, 1.9, 1480.0, "HIGH", date(2023, 3, 29),
                    [RoofConfig(c["panelsCount"], c["yearlyEnergyDcKwh"]) for c in d["solarPanelConfigs"]])


@pytest.fixture
def computed(client):
    pid = _setup(client)
    lines = _lines(pid)
    lines[0] = lines[0].model_copy(update={"quantity": 20_000, "amount": 44_000_000, "currency": "đ"})
    client.repo.add_activity_lines("sup-1", pid, lines)
    assert client.post(f"{URL}/periods/{pid}/compute", headers=_auth()).status_code == 200
    return pid


def test_advisor_needs_an_inventory_and_the_owner(client):
    pid = _setup(client)
    assert client.get(f"{URL}/periods/{pid}/advisor", headers=_auth()).status_code == 409
    assert client.get(f"{URL}/periods/{pid}/advisor", headers=_auth("sup-2")).status_code == 403
    assert client.post(f"{URL}/sites/main/locate", json={"roof_area_m2": 100}, headers=_auth("sup-2")).status_code == 403


def test_unlocated_site_still_gets_levers_and_a_prompt_to_locate(client, computed):
    r = client.get(f"{URL}/periods/{computed}/advisor", headers=_auth()).json()
    assert r["located"] is False and r["coverage"] == "none" and r["error"] is None
    assert not r["advice"]["solar"]["available"]
    assert {l["id"] for l in r["advice"]["levers"]} >= {"led", "rec"}


def test_locate_from_coordinates_and_from_an_address(client, computed, monkeypatch):
    _setup(client)
    r = client.post(f"{URL}/sites/main/locate", json={"lat": 34.9886, "lng": 137.0022}, headers=_auth())
    s = r.json()["sites"][0]
    assert r.status_code == 200 and s["lat"] == 34.9886 and s["formatted_address"] == "34.98860, 137.00220"

    monkeypatch.setattr(solar, "geocode", lambda a, c=None, **k: Place(10.73, 106.89, "Nhơn Trạch, Đồng Nai, Vietnam"))
    r = client.post(f"{URL}/sites/main/locate", json={"address": " Nhon Trach IZ "}, headers=_auth())
    s = r.json()["sites"][0]
    assert s["address"] == "Nhon Trach IZ" and s["lat"] == 10.73 and s["formatted_address"].startswith("Nhơn Trạch")


def test_locate_reports_unknown_addresses_and_google_errors_and_rejects_empty(client, computed, monkeypatch):
    monkeypatch.setattr(solar, "geocode", lambda a, c=None, **k: None)
    assert client.post(f"{URL}/sites/main/locate", json={"address": "zzzz"}, headers=_auth()).status_code == 404

    def deny(a, c=None, **k):
        raise solar.SolarError("geocoding: Google rejected the request (403)")

    monkeypatch.setattr(solar, "geocode", deny)
    r = client.post(f"{URL}/sites/main/locate", json={"address": "x"}, headers=_auth())
    assert r.status_code == 502 and "rejected" in r.json()["detail"]
    assert client.post(f"{URL}/sites/main/locate", json={}, headers=_auth()).status_code == 400
    assert client.post(f"{URL}/sites/nope/locate", json={"roof_area_m2": 5}, headers=_auth()).status_code == 404
    assert client.post(f"{URL}/sites/main/locate", json={"lat": 123, "lng": 0}, headers=_auth()).status_code == 422


def test_advisor_uses_roof_data_where_google_has_it(client, computed, monkeypatch):
    client.post(f"{URL}/sites/main/locate", json={"lat": 34.9886, "lng": 137.0022}, headers=_auth())
    monkeypatch.setattr(solar, "building_insights", lambda la, ln, **k: building())
    r = client.get(f"{URL}/periods/{computed}/advisor", headers=_auth()).json()
    s = r["advice"]["solar"]
    assert r["coverage"] == "solar_api" and s["precision"] == "solar_api" and s["imagery_quality"] == "HIGH"
    assert s["panels"] == 20 and s["share_of_electricity"] == pytest.approx(9010 / 20_000, abs=1e-3)   # largest layout not above use


def test_advisor_falls_back_to_irradiance_and_asks_for_roof_area(client, computed, monkeypatch):
    client.post(f"{URL}/sites/main/locate", json={"lat": 10.73, "lng": 106.89}, headers=_auth())
    monkeypatch.setattr(solar, "building_insights", lambda la, ln, **k: None)
    monkeypatch.setattr(solar, "pvgis_yield", lambda la, ln, **k: 1453.0)
    r = client.get(f"{URL}/periods/{computed}/advisor", headers=_auth()).json()
    assert r["coverage"] == "pvgis" and r["advice"]["solar"]["needs_roof_area"] is True

    client.post(f"{URL}/sites/main/locate", json={"roof_area_m2": 400}, headers=_auth())
    r = client.get(f"{URL}/periods/{computed}/advisor", headers=_auth()).json()
    s = r["advice"]["solar"]
    assert s["available"] and s["precision"] == "pvgis_estimate" and s["kwp"] == pytest.approx(20_000 / 1453, abs=0.01)   # sized to use, not to the 48 kWp the roof allows
    assert s["tariff"] == pytest.approx(2200.0) and s["payback_years"] is not None     # 44,000,000 đ / 20,000 kWh, from the bill


def test_a_google_failure_degrades_to_levers_with_a_message(client, computed, monkeypatch):
    client.post(f"{URL}/sites/main/locate", json={"lat": 10.73, "lng": 106.89}, headers=_auth())

    def boom(la, ln, **k):
        raise solar.SolarError("solar: quota exceeded; try again later")

    monkeypatch.setattr(solar, "building_insights", boom)
    r = client.get(f"{URL}/periods/{computed}/advisor", headers=_auth())
    assert r.status_code == 200 and "quota" in r.json()["error"] and r.json()["advice"]["levers"]


def test_saving_the_profile_keeps_the_lookup_until_the_address_changes(client):
    body = {**PROFILE, "sites": [{"name": "Plant", "country": "VN", "address": "1 Road"}]}
    sid = client.post("/suppliers", json=body, headers=_auth()).json()["sites"][0]["id"]
    client.post(f"{URL}/sites/{sid}/locate", json={"lat": 10.7, "lng": 106.9, "roof_area_m2": 500}, headers=_auth())
    s = client.post("/suppliers", json=body, headers=_auth()).json()["sites"][0]
    assert s["lat"] == 10.7 and s["roof_area_m2"] == 500
    moved = {**PROFILE, "sites": [{"name": "Plant", "country": "VN", "address": "2 Other Road"}]}
    s = client.post("/suppliers", json=moved, headers=_auth()).json()["sites"][0]
    assert s["lat"] is None and s["roof_area_m2"] == 500                  # the pin is stale, the roof figure is the supplier's


def test_draft_reduction_answer_is_flagged_modest_and_only_when_there_is_something():
    a = advise(inventory=VN, activity=[], country="VN", site_id="main", single_site=True, building=None, pvgis_kwh_per_kwp=1453, roof_area_m2=800)
    txt = _draft_reductions(a, VN)
    assert txt.startswith("DRAFT, please confirm") and "rooftop solar" in txt and "tCO2e a year" in txt and "not commitments" in txt
    assert "switch lpg heating" not in txt                                  # a lever that would raise emissions is never offered
    assert _draft_reductions(None, VN) and "rooftop solar" not in _draft_reductions(None, VN)
    assert _draft_reductions(None, []) is None


def test_locate_marks_street_level_matches_and_takes_pasted_coordinates(client, computed, monkeypatch):
    monkeypatch.setattr(solar, "geocode", lambda a, c=None, **k: Place(10.6, 106.6, "Long An, Vietnam", False))
    s = client.post(f"{URL}/sites/main/locate", json={"address": "Long An"}, headers=_auth()).json()["sites"][0]
    assert s["location_precision"] == "approximate"

    monkeypatch.setattr(solar, "geocode", lambda a, c=None, **k: Place(10.73, 106.89, "Lot B2, Long Hau IP, Vietnam", True))
    s = client.post(f"{URL}/sites/main/locate", json={"address": "Lot B2, Long Hau IP"}, headers=_auth()).json()["sites"][0]
    assert s["location_precision"] == "exact"

    def never(*a, **k):
        raise AssertionError("coordinates must not be geocoded")

    monkeypatch.setattr(solar, "geocode", never)
    s = client.post(f"{URL}/sites/main/locate", json={"address": "10.7290, 106.7190"}, headers=_auth()).json()["sites"][0]
    assert (s["lat"], s["lng"], s["location_precision"]) == (10.729, 106.719, "exact")
    assert s["formatted_address"] == "10.72900, 106.71900" and s["address"] == "10.7290, 106.7190"
