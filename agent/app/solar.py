"""Where a site is and what its roof can do: Geocoding, the Solar API and PVGIS.

Three small calls behind one cache:

* `geocode`           address -> latitude, longitude (Google Geocoding API)
* `building_insights` roof area, panel layouts and yearly kWh for the building
                      at that point (Google Solar API). `None` when Google has
                      no roof data there, which is the case for Vietnam.
* `pvgis_yield`       kWh per kWp per year from the EU's PVGIS service, free and
                      keyless, used when the Solar API has nothing.

Every response is cached on disk (like the Gemini client), so a re-run, a test
and a demo cost no quota. The API key is added to the request only; it never
reaches a cache key, a log line or an exception message.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import httpx

from .settings import get_settings

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
SOLAR_URL = "https://solar.googleapis.com/v1/buildingInsights:findClosest"
PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc"
TIMEOUT = 20.0
# Geocoding "types" that mean a whole country or first-level province was matched, not a place.
BROAD_TYPES = frozenset({"country", "administrative_area_level_1"})

log = logging.getLogger(__name__)


class SolarError(RuntimeError):
    """A failure the caller can show: bad key, quota, address not found, service down."""


@dataclass(frozen=True)
class Place:
    lat: float
    lng: float
    formatted_address: str
    # False when Google only matched a street, district or city (not a building or an interpolated number),
    # in which case "the building nearest this point" may be the wrong roof.
    precise: bool = True
    # What Google says it matched ("street_address", "route", "locality", "country", ...). Empty when not given.
    types: tuple[str, ...] = ()

    @property
    def too_broad(self) -> bool:
        """A whole country or province: the point is the middle of nowhere in particular, so no roof is near it."""
        return bool(set(self.types) & BROAD_TYPES)


@dataclass(frozen=True)
class RoofConfig:
    panels: int
    yearly_dc_kwh: float


@dataclass(frozen=True)
class Building:
    max_panels: int
    max_array_area_m2: float
    whole_roof_area_m2: float
    panel_capacity_w: float
    panel_area_m2: float
    max_sunshine_hours: float
    imagery_quality: str
    imagery_date: date | None
    configs: list[RoofConfig] = field(default_factory=list)


@contextlib.contextmanager
def _http(client: httpx.Client | None):
    """The caller's client (tests) stays open; one we create is closed."""
    if client is not None:
        yield client
    else:
        with httpx.Client() as c:
            yield c


def _cache_dir() -> Path:
    s = get_settings()
    d = s.resolve(s.solar_cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _geocode_answer(body: dict) -> bool:
    """Geocoding reports its errors inside an HTTP 200 (REQUEST_DENIED, OVER_QUERY_LIMIT). Only real answers are kept."""
    return body.get("status") in ("OK", "ZERO_RESULTS")


def _cached_get(client: httpx.Client, url: str, params: dict, *, secret: dict | None = None, ok_statuses: tuple[int, ...] = (200,),
                keep=None) -> tuple[int, dict]:
    """GET with an on-disk cache. `secret` params are sent but never keyed or stored.
    `keep(body)` can veto caching, on write and on read, so a failure is never remembered."""
    key = hashlib.sha256(json.dumps([url, sorted(params.items())], default=str).encode()).hexdigest()[:32]
    f = _cache_dir() / f"{key}.json"
    if f.exists():
        d = json.loads(f.read_text())
        if keep is None or keep(d["body"]):
            return d["status"], d["body"]
    try:
        r = client.get(url, params={**params, **(secret or {})}, timeout=TIMEOUT)
    except httpx.HTTPError as e:   # the message of an httpx error can contain the full URL, key included
        raise SolarError(f"could not reach {httpx.URL(url).host}: {type(e).__name__}") from None
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code in ok_statuses and (keep is None or keep(body)):
        f.write_text(json.dumps({"status": r.status_code, "body": body}))
    return r.status_code, body


def _api_error(status: int, body: dict, what: str) -> SolarError:
    err = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
    msg = err.get("message") or body.get("error_message") or ""
    if status in (400, 403) or "API key" in msg or "not authorized" in msg.lower():
        return SolarError(f"{what}: Google rejected the request ({status}); check the API key and that the API is enabled and unrestricted for this key")
    if status == 429:
        return SolarError(f"{what}: quota exceeded; try again later")
    return SolarError(f"{what}: unexpected response ({status})")


# Two decimal numbers, as Google Maps copies them. Both need a decimal point so "12 34 Main St" stays an address.
_COORDS = re.compile(r"^\s*(-?\d{1,3}\.\d+)\s*°?\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*°?\s*$")


def parse_coordinates(text: str) -> tuple[float, float] | None:
    """"10.7290, 106.7190" (as copied from Google Maps) to (lat, lng); None for anything that is an address."""
    m = _COORDS.match(text or "")
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    return (lat, lng) if abs(lat) <= 90 and abs(lng) <= 180 else None


def geocode(address: str, country: str | None = None, *, client: httpx.Client | None = None) -> Place | None:
    """Address -> coordinates, biased to the supplier's country. None when nothing matches."""
    key = get_settings().google_maps_api_key
    if not key:
        raise SolarError("GOOGLE_MAPS_API_KEY is not configured")
    params: dict = {"address": address.strip()}
    if country:
        params["components"] = f"country:{country.upper()}"
    with _http(client) as c:
        status, body = _cached_get(c, GEOCODE_URL, params, secret={"key": key}, keep=_geocode_answer)
    if status != 200:
        raise _api_error(status, body, "geocoding")
    st = body.get("status")
    if st == "ZERO_RESULTS":
        return None
    if st != "OK":
        raise _api_error(403 if st == "REQUEST_DENIED" else 500, body, "geocoding")
    top = body["results"][0]
    loc = top["geometry"]["location"]
    location_type = top.get("geometry", {}).get("location_type")
    partial = bool(top.get("partial_match"))
    types = tuple(str(t) for t in top.get("types", []))
    precise = location_type in ("ROOFTOP", "RANGE_INTERPOLATED") and not partial
    # Not secret, and the only way to explain a surprising match after the fact.
    log.info("geocode match: types=%s location_type=%s partial_match=%s results=%d", ",".join(types) or "-", location_type, partial, len(body["results"]))
    return Place(float(loc["lat"]), float(loc["lng"]), top.get("formatted_address", address), precise, types)


# --- Places API (New): address suggestions as you type ------------------------------------------
#
# Billing is per search session: every suggest call and the one details call that ends it carry the same
# `session` token. Details asks for Essentials fields only (id, address, location, types); a name, rating or
# phone number would switch to a dearer SKU. Nothing here is cached: a suggestion list is only useful live,
# and the key travels in a header, so it is in no URL, cache key or log line.

PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places/"
PLACES_FIELDS = "id,formattedAddress,location,types"
_PLACE_ID = re.compile(r"^[A-Za-z0-9_-]{10,300}$")
_SESSION = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
# A match on one of these is a building or a named place; anything else is a road, district or city.
PRECISE_TYPES = frozenset({"street_address", "premise", "subpremise", "establishment", "point_of_interest", "street_number"})


@dataclass(frozen=True)
class Suggestion:
    place_id: str
    text: str
    main: str
    secondary: str


def valid_place_id(place_id: str) -> bool:
    return bool(_PLACE_ID.match(place_id or ""))


def valid_session(session: str | None) -> bool:
    return bool(session) and bool(_SESSION.match(session or ""))


def _places_call(method: str, url: str, *, headers: dict, params: dict | None = None, json_body: dict | None = None,
                 client: httpx.Client | None = None) -> tuple[int, dict]:
    key = get_settings().google_maps_api_key
    if not key:
        raise SolarError("GOOGLE_MAPS_API_KEY is not configured")
    with _http(client) as c:
        try:
            r = c.request(method, url, params=params, json=json_body, headers={**headers, "X-Goog-Api-Key": key}, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            raise SolarError(f"could not reach {httpx.URL(url).host}: {type(e).__name__}") from None
    try:
        body = r.json()
    except ValueError:
        body = {}
    return r.status_code, body if isinstance(body, dict) else {}


def suggest(query: str, country: str | None, session: str, language: str | None = None, *, client: httpx.Client | None = None) -> list[Suggestion]:
    """Up to five address suggestions for what has been typed so far, inside the supplier's country."""
    q = query.strip()
    if len(q) < 3:
        return []
    body: dict = {"input": q, "sessionToken": session}
    if country and len(country) == 2:
        body["includedRegionCodes"] = [country.lower()]
    if language:
        body["languageCode"] = language
    status, data = _places_call("POST", PLACES_AUTOCOMPLETE_URL, headers={}, json_body=body, client=client)
    if status != 200:
        raise _api_error(status, data, "address search")
    out: list[Suggestion] = []
    for s in data.get("suggestions", []):
        p = s.get("placePrediction")
        if not p or not p.get("placeId"):
            continue
        fmt = p.get("structuredFormat") or {}
        text = (p.get("text") or {}).get("text", "")
        main = (fmt.get("mainText") or {}).get("text", text)
        out.append(Suggestion(p["placeId"], text or main, main, (fmt.get("secondaryText") or {}).get("text", "")))
    return out[:5]


def place_details(place_id: str, session: str | None = None, language: str | None = None, *, client: httpx.Client | None = None) -> Place | None:
    """The chosen suggestion as a point. This call closes the billing session. None when Google no longer knows the id."""
    params = {k: v for k, v in (("sessionToken", session), ("languageCode", language)) if v}
    status, data = _places_call("GET", PLACES_DETAILS_URL + place_id, headers={"X-Goog-FieldMask": PLACES_FIELDS}, params=params, client=client)
    if status == 404:
        return None
    if status != 200:
        raise _api_error(status, data, "address search")
    loc = data.get("location") or {}
    if "latitude" not in loc or "longitude" not in loc:
        return None
    types = tuple(str(t) for t in data.get("types", []))
    precise = bool(set(types) & PRECISE_TYPES)
    log.info("place details: types=%s precise=%s", ",".join(types) or "-", precise)
    return Place(float(loc["latitude"]), float(loc["longitude"]), data.get("formattedAddress", ""), precise, types)


def building_insights(lat: float, lng: float, *, client: httpx.Client | None = None) -> Building | None:
    """Roof data for the building nearest this point. None when the Solar API has no coverage (404)."""
    key = get_settings().google_maps_api_key
    if not key:
        raise SolarError("GOOGLE_MAPS_API_KEY is not configured")
    params = {"location.latitude": f"{lat:.6f}", "location.longitude": f"{lng:.6f}", "requiredQuality": "BASE"}
    with _http(client) as c:
        status, body = _cached_get(c, SOLAR_URL, params, secret={"key": key}, ok_statuses=(200, 404))
    if status == 404:
        return None
    if status != 200:
        raise _api_error(status, body, "solar")
    sp = body.get("solarPotential") or {}
    configs = [RoofConfig(int(c["panelsCount"]), float(c["yearlyEnergyDcKwh"])) for c in sp.get("solarPanelConfigs", [])]
    if not configs:
        return None
    d = body.get("imageryDate") or {}
    when = None
    try:
        when = date(int(d["year"]), int(d.get("month", 1)), int(d.get("day", 1)))
    except (KeyError, ValueError):
        pass
    w, h = float(sp.get("panelWidthMeters", 1.045)), float(sp.get("panelHeightMeters", 1.879))
    return Building(
        max_panels=int(sp.get("maxArrayPanelsCount", max(c.panels for c in configs))),
        max_array_area_m2=float(sp.get("maxArrayAreaMeters2", 0.0)),
        whole_roof_area_m2=float((sp.get("wholeRoofStats") or {}).get("areaMeters2", 0.0)),
        panel_capacity_w=float(sp.get("panelCapacityWatts", 400.0)),
        panel_area_m2=w * h,
        max_sunshine_hours=float(sp.get("maxSunshineHoursPerYear", 0.0)),
        imagery_quality=str(body.get("imageryQuality", "")),
        imagery_date=when,
        configs=sorted(configs, key=lambda c: c.panels),
    )


def pvgis_yield(lat: float, lng: float, *, client: httpx.Client | None = None) -> float:
    """kWh per kWp per year for an optimally tilted fixed array, 14 % system losses (ERA5 irradiance)."""
    params = {"lat": f"{lat:.4f}", "lon": f"{lng:.4f}", "peakpower": 1, "loss": 14, "optimalangles": 1,
              "raddatabase": "PVGIS-ERA5", "outputformat": "json"}
    with _http(client) as c:
        status, body = _cached_get(c, PVGIS_URL, params)
    if status != 200:
        raise SolarError(f"pvgis: no irradiance data for this location ({status})")
    try:
        return float(body["outputs"]["totals"]["fixed"]["E_y"])
    except (KeyError, TypeError, ValueError):
        raise SolarError("pvgis: unexpected response") from None
