"""The Solar / Geocoding / PVGIS client against canned responses. No network, no key."""

import json
from pathlib import Path

import httpx
import pytest

from app import solar
from app.settings import get_settings

FIX = Path(__file__).parent / "fixtures"
SECRET = "AIza-test-secret-key-0123456789"


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", SECRET)
    monkeypatch.setenv("SOLAR_CACHE_DIR", str(tmp_path / "solar"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_building_insights_parses_roof_and_orders_configs():
    calls = []

    def h(req):
        calls.append(req)
        return httpx.Response(200, json=json.loads((FIX / "solar_kariya.json").read_text()))

    b = solar.building_insights(34.9886, 137.0022, client=client(h))
    assert b.imagery_quality == "HIGH" and b.imagery_date.year == 2023
    assert b.max_panels == 68 and b.whole_roof_area_m2 == 305.0 and b.panel_capacity_w == 400
    assert [c.panels for c in b.configs] == [4, 20, 68]
    assert 1.9 < b.panel_area_m2 < 2.1
    assert calls[0].url.params["requiredQuality"] == "BASE"


def test_404_means_not_covered_and_is_cached():
    n = {"calls": 0}

    def h(req):
        n["calls"] += 1
        return httpx.Response(404, json={"error": {"code": 404, "message": "Requested entity was not found."}})

    assert solar.building_insights(10.73, 106.89, client=client(h)) is None
    assert solar.building_insights(10.73, 106.89, client=client(h)) is None
    assert n["calls"] == 1                               # second answer came from disk


def test_success_is_cached_so_reruns_cost_nothing():
    n = {"calls": 0}

    def h(req):
        n["calls"] += 1
        return httpx.Response(200, json=json.loads((FIX / "solar_kariya.json").read_text()))

    solar.building_insights(34.9886, 137.0022, client=client(h))
    solar.building_insights(34.9886, 137.0022, client=client(h))
    assert n["calls"] == 1


def test_errors_are_clear_and_never_contain_the_key():
    def denied(req):
        return httpx.Response(403, json={"error": {"code": 403, "message": f"API key not valid: {SECRET}"}})

    with pytest.raises(solar.SolarError) as e:
        solar.building_insights(1, 1, client=client(denied))
    assert "rejected" in str(e.value) and SECRET not in str(e.value)

    def quota(req):
        return httpx.Response(429, json={"error": {"code": 429}})

    with pytest.raises(solar.SolarError, match="quota"):
        solar.building_insights(2, 2, client=client(quota))

    def boom(req):
        raise httpx.ConnectError(f"failed for {req.url}")      # the URL carries the key

    with pytest.raises(solar.SolarError) as e:
        solar.building_insights(3, 3, client=client(boom))
    assert SECRET not in str(e.value) and SECRET not in repr(e.value.__cause__)


def test_key_is_sent_but_never_stored_in_the_cache():
    def h(req):
        assert req.url.params["key"] == SECRET
        return httpx.Response(200, json=json.loads((FIX / "solar_kariya.json").read_text()))

    solar.building_insights(34.9886, 137.0022, client=client(h))
    cache = get_settings().resolve(get_settings().solar_cache_dir)
    assert all(SECRET not in f.read_text() for f in cache.glob("*.json"))
    assert all(SECRET not in f.name for f in cache.glob("*.json"))


def test_missing_key_is_a_clear_error(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(solar.SolarError, match="not configured"):
        solar.geocode("x")


def test_geocode_ok_zero_results_and_denied():
    ok = {"status": "OK", "results": [{"formatted_address": "Kariya, Aichi, Japan", "geometry": {"location": {"lat": 34.99, "lng": 137.0}}}]}
    p = solar.geocode("Kariya", "jp", client=client(lambda r: httpx.Response(200, json=ok)))
    assert (p.lat, p.lng, p.formatted_address) == (34.99, 137.0, "Kariya, Aichi, Japan")

    seen = {}

    def h(req):
        seen.update(req.url.params)
        return httpx.Response(200, json={"status": "ZERO_RESULTS", "results": []})

    assert solar.geocode("nowhere at all", "VN", client=client(h)) is None
    assert seen["components"] == "country:VN"

    denied = {"status": "REQUEST_DENIED", "error_message": "This API is not activated on your API project."}
    with pytest.raises(solar.SolarError, match="rejected"):
        solar.geocode("denied", client=client(lambda r: httpx.Response(200, json=denied)))


def test_pvgis_returns_kwh_per_kwp_or_a_clear_error():
    ok = {"outputs": {"totals": {"fixed": {"E_y": 1452.89}}}}
    assert solar.pvgis_yield(10.73, 106.89, client=client(lambda r: httpx.Response(200, json=ok))) == 1452.89
    with pytest.raises(solar.SolarError, match="pvgis"):
        solar.pvgis_yield(0, 0, client=client(lambda r: httpx.Response(400, json={"message": "Location over the sea"})))
