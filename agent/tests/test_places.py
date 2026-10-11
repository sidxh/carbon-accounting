"""Address suggestions (Places API New): the client against canned responses, and the routes around it."""

import json

import httpx
import pytest

from app import main, solar
from app.settings import get_settings
from app.solar import Place, Suggestion
from tests.test_advisor_api import URL, _auth, computed  # noqa: F401  (fixture)
from tests.test_solar import SECRET, client as http_client

SESSION = "sess_abcdef123456"
PID = "ChIJ-abcdefghijklmnop"


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", SECRET)
    monkeypatch.setenv("SOLAR_CACHE_DIR", str(tmp_path / "solar"))
    get_settings.cache_clear()
    main._suggest_log.clear()
    yield
    get_settings.cache_clear()


SUGGESTIONS = {"suggestions": [
    {"placePrediction": {"placeId": PID, "text": {"text": "Lot B2, Long Hau Industrial Park, Cần Giuộc, Long An, Vietnam"},
                         "structuredFormat": {"mainText": {"text": "Lot B2"}, "secondaryText": {"text": "Long Hau Industrial Park, Long An"}}}},
    {"queryPrediction": {"text": {"text": "long hau"}}},                      # not a place: skipped
]}


def test_suggest_sends_session_country_and_key_in_headers_only():
    seen = {}

    def h(req):
        seen.update(url=str(req.url), key=req.headers["x-goog-api-key"], body=json.loads(req.content))
        return httpx.Response(200, json=SUGGESTIONS)

    out = solar.suggest("  Lot B2 Long Hau ", "VN", SESSION, "vi", client=http_client(h))
    assert out == [Suggestion(PID, "Lot B2, Long Hau Industrial Park, Cần Giuộc, Long An, Vietnam", "Lot B2", "Long Hau Industrial Park, Long An")]
    assert seen["body"] == {"input": "Lot B2 Long Hau", "sessionToken": SESSION, "includedRegionCodes": ["vn"], "languageCode": "vi"}
    assert seen["key"] == SECRET and SECRET not in seen["url"]


def test_suggest_skips_the_call_for_short_input_and_reports_errors_without_the_key():
    def never(req):
        raise AssertionError("no request for under 3 characters")

    assert solar.suggest("ab ", "VN", SESSION, client=http_client(never)) == []

    def denied(req):
        return httpx.Response(403, json={"error": {"code": 403, "message": f"Places API (New) has not been used: {SECRET}"}})

    with pytest.raises(solar.SolarError) as e:
        solar.suggest("long hau", "VN", SESSION, client=http_client(denied))
    assert "rejected" in str(e.value) and SECRET not in str(e.value)

    def boom(req):
        raise httpx.ConnectError(f"failed for {req.url} {req.headers}")

    with pytest.raises(solar.SolarError) as e:
        solar.suggest("long hau", "VN", SESSION, client=http_client(boom))
    assert SECRET not in str(e.value) and SECRET not in repr(e.value.__cause__)


def test_place_details_asks_for_essentials_fields_only_and_reads_precision():
    seen = {}

    def h(req):
        seen.update(path=req.url.path, mask=req.headers["x-goog-fieldmask"], session=req.url.params["sessionToken"])
        return httpx.Response(200, json={"id": PID, "formattedAddress": "Lot B2, Long Hau IP, Vietnam",
                                         "location": {"latitude": 10.6, "longitude": 106.6}, "types": ["establishment", "point_of_interest"]})

    p = solar.place_details(PID, SESSION, client=http_client(h))
    assert seen["path"] == f"/v1/places/{PID}" and seen["session"] == SESSION
    assert seen["mask"] == "id,formattedAddress,location,types"          # Essentials: anything more changes the price tier
    assert (p.lat, p.lng, p.precise, p.too_broad) == (10.6, 106.6, True, False)

    road = solar.place_details(PID, client=http_client(lambda r: httpx.Response(200, json={"formattedAddress": "QL50", "location": {"latitude": 1, "longitude": 2}, "types": ["route"]})))
    assert road.precise is False
    country = solar.place_details(PID, client=http_client(lambda r: httpx.Response(200, json={"formattedAddress": "Vietnam", "location": {"latitude": 1, "longitude": 2}, "types": ["country", "political"]})))
    assert country.too_broad is True
    assert solar.place_details(PID, client=http_client(lambda r: httpx.Response(404, json={"error": {"code": 404}}))) is None


def test_validators():
    assert solar.valid_place_id(PID) and not solar.valid_place_id("a/../b") and not solar.valid_place_id("")
    assert solar.valid_session(SESSION) and not solar.valid_session("short") and not solar.valid_session(None)


# --- routes -------------------------------------------------------------------------------------

def test_suggest_route_uses_the_profile_country_and_the_locale(client, computed, monkeypatch):
    seen = {}

    def fake(q, cc, session, lang=None, **k):
        seen.update(q=q, cc=cc, session=session, lang=lang)
        return [Suggestion(PID, "Lot B2, Vietnam", "Lot B2", "Vietnam")]

    monkeypatch.setattr(solar, "suggest", fake)
    r = client.get("/places/suggest", params={"q": "lot b2", "session": SESSION}, headers={**_auth(), "X-Locale": "ja"})
    assert r.status_code == 200
    assert r.json() == {"suggestions": [{"place_id": PID, "text": "Lot B2, Vietnam", "main": "Lot B2", "secondary": "Vietnam"}]}
    assert seen == {"q": "lot b2", "cc": "VN", "session": SESSION, "lang": "ja"}

    assert client.get("/places/suggest", params={"q": "lot", "session": SESSION, "country": "au"}, headers=_auth()).status_code == 200
    assert seen["cc"] == "au"
    assert client.get("/places/suggest", params={"q": "lot", "session": SESSION, "country": "xyz"}, headers=_auth()).status_code == 422


def test_suggest_route_needs_a_real_query_and_session(client, computed, monkeypatch):
    monkeypatch.setattr(solar, "suggest", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not call Google")))
    assert client.get("/places/suggest", params={"q": "ab", "session": SESSION}, headers=_auth()).json() == {"suggestions": []}
    assert client.get("/places/suggest", params={"q": "long hau"}, headers=_auth()).status_code == 400
    assert client.get("/places/suggest", params={"q": "long hau", "session": "../x"}, headers=_auth()).status_code == 400


def test_suggest_route_shows_google_failures_as_502(client, computed, monkeypatch):
    def deny(*a, **k):
        raise solar.SolarError("address search: Google rejected the request (403)")

    monkeypatch.setattr(solar, "suggest", deny)
    assert client.get("/places/suggest", params={"q": "long hau", "session": SESSION}, headers=_auth()).status_code == 502


def test_suggest_route_limits_each_user_per_hour(client, computed, monkeypatch):
    monkeypatch.setenv("PLACES_HOURLY_LIMIT", "3")
    get_settings.cache_clear()
    monkeypatch.setattr(main, "settings", get_settings())
    monkeypatch.setattr(solar, "suggest", lambda *a, **k: [])
    codes = [client.get("/places/suggest", params={"q": "long hau", "session": SESSION}, headers=_auth()).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_locate_with_a_picked_suggestion_pins_the_place(client, computed, monkeypatch):
    seen = {}

    def fake(pid, session=None, language=None, **k):
        seen.update(pid=pid, session=session)
        return Place(10.6, 106.6, "Lot B2, Long Hau IP, Vietnam", True, ("establishment",))

    monkeypatch.setattr(solar, "place_details", fake)
    monkeypatch.setattr(solar, "geocode", lambda *a, **k: (_ for _ in ()).throw(AssertionError("a picked place is not geocoded")))
    r = client.post(f"{URL}/sites/main/locate", json={"address": "lot b2", "place_id": PID, "session": SESSION}, headers=_auth())
    assert r.status_code == 200
    s = r.json()["sites"][0]
    assert (s["lat"], s["lng"], s["location_precision"]) == (10.6, 106.6, "exact")
    assert s["address"] == s["formatted_address"] == "Lot B2, Long Hau IP, Vietnam"
    assert seen == {"pid": PID, "session": SESSION}

    monkeypatch.setattr(solar, "place_details", lambda *a, **k: Place(10.5, 106.5, "QL50, Long An", False, ("route",)))
    s = client.post(f"{URL}/sites/main/locate", json={"place_id": PID}, headers=_auth()).json()["sites"][0]
    assert s["location_precision"] == "approximate"


def test_locate_with_a_bad_missing_or_too_broad_place(client, computed, monkeypatch):
    assert client.post(f"{URL}/sites/main/locate", json={"place_id": "../etc"}, headers=_auth()).status_code == 400
    monkeypatch.setattr(solar, "place_details", lambda *a, **k: None)
    assert client.post(f"{URL}/sites/main/locate", json={"place_id": PID}, headers=_auth()).status_code == 404
    monkeypatch.setattr(solar, "place_details", lambda *a, **k: Place(14, 108, "Vietnam", False, ("country",)))
    r = client.post(f"{URL}/sites/main/locate", json={"place_id": PID}, headers=_auth())
    assert r.status_code == 422 and "too broad" in r.json()["detail"]

    def deny(*a, **k):
        raise solar.SolarError("address search: quota exceeded; try again later")

    monkeypatch.setattr(solar, "place_details", deny)
    assert client.post(f"{URL}/sites/main/locate", json={"place_id": PID}, headers=_auth()).status_code == 502
