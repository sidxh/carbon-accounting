"""HTTP surface of the agent service.

Every route is scoped to the caller's own supplier record: the Firebase uid
in the ID token *is* the supplier id, and `require_supplier` refuses anything
else. Bills, the conversation and the inventory hang off a reporting period
(`/periods/{pid}/…`); a customer request points at a period and owns its
questionnaire (`/requests/{rid}/…`). Routes are plain `def` so FastAPI runs
them in a worker thread — the reconciler drives an ADK runner with
`asyncio.run`, which needs to be outside the server's event loop.
"""

from __future__ import annotations

import mimetypes
import time
import uuid
from collections import defaultdict, deque
from datetime import UTC, date, datetime

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import solar
from .agents import reconciler
from .agents.filler import LOCKED_FIELDS, Answer, fill_workbook, write_answers
from .auth import Caller, current_caller, require_supplier
from .checks import confirm_failed_checks
from .exporters.methodology import build_pdf
from .facts import FactContext, previous_year_of
from .models import ReportingPeriod, Request, Site, SupplierProfile
from .packs import PACK_BANKS, build_pack, to_pdf, to_xlsx
from .questionnaires import get_bank
from .reconcile_tools import summarise
from .repo import QuestionnaireRecord, ReconcileState, get_repo
from .services import (
    build_advice,
    build_evidence,
    compute_inventory,
    default_period,
    default_site_id,
    delete_period,
    make_period,
    period_prefix,
    period_progress,
    register_and_extract,
    remove_document,
    request_status,
    reset_all,
    reset_period,
    reset_questions,
    retry_extraction,
)
from .settings import get_settings
from .storage import get_storage
from .vsme import VsmeError, fill_vsme

settings = get_settings()
app = FastAPI(title="Supplier carbon reporting agent", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --- schemas ------------------------------------------------------------------

class SiteIn(BaseModel):
    id: str | None = None
    name: str
    country: str
    region: str | None = None
    address: str | None = None


class SupplierIn(BaseModel):
    name: str = ""
    country: str = "VN"
    language: str = "vi"
    fiscal_year_start: date
    fiscal_year_end: date
    sites: list[SiteIn] = Field(default_factory=list)
    sector: str = ""
    revenue: float | None = None
    revenue_currency: str | None = None
    headcount: int | None = Field(default=None, ge=0, le=10_000_000)
    nace_code: str = Field(default="", max_length=40)


class LocateIn(BaseModel):
    address: str | None = None
    # A suggestion the supplier picked (from /places/suggest). The address text is then only a label.
    place_id: str | None = Field(default=None, max_length=300)
    session: str | None = Field(default=None, max_length=64)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    roof_area_m2: float | None = Field(default=None, gt=0, le=1_000_000)


class PeriodIn(BaseModel):
    start: date
    end: date
    label: str | None = None


class RequestIn(BaseModel):
    customer_name: str
    period_id: str | None = None
    new_period: PeriodIn | None = None
    due_date: date | None = None
    customer_share: float | None = Field(default=None, ge=0, le=1)


class RequestPatch(BaseModel):
    customer_name: str | None = None
    due_date: date | None = None
    customer_share: float | None = Field(default=None, ge=0, le=1)
    clear_due_date: bool = False


class ReplyIn(BaseModel):
    message: str


class LinePatch(BaseModel):
    quantity: float | None = None
    energy_type: str | None = None
    site_id: str | None = None
    note: str | None = None


class AnswerPatch(BaseModel):
    value: str


# --- helpers ---------------------------------------------------------------------

def _profile_or_404(uid: str) -> SupplierProfile:
    p = get_repo().get_supplier(uid)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Set up your supplier profile first.")
    return p


def _period_or_404(uid: str, pid: str) -> ReportingPeriod:
    p = get_repo().get_period(uid, pid)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporting period not found.")
    return p


def _request_or_404(uid: str, rid: str) -> Request:
    r = get_repo().get_request(uid, rid)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    return r


def _file_response(key: str, download_name: str | None = None) -> Response:
    storage = get_storage()
    if not storage.exists(key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    # Always stream the bytes through the agent. A redirect to a signed storage link breaks the web app,
    # which fetches with an Authorization header and then reads the blob: storage sends no CORS headers.
    data = storage.get(key)
    media = mimetypes.guess_type(key)[0] or "application/octet-stream"
    headers = {"Content-Disposition": f'inline; filename="{download_name or key.rsplit("/", 1)[-1]}"'}
    return Response(content=data, media_type=media, headers=headers)


def _request_view(uid: str, req: Request) -> dict:
    """A request with its derived status and the period's progress flags."""
    repo = get_repo()
    period = repo.get_period(uid, req.period_id)
    progress = period_progress(repo, uid, req.period_id) if period else {"bills": False, "questions": False, "inventory": False, "documents": 0, "reconcile_status": "idle"}
    shared_with = [r.customer_name for r in repo.list_requests(uid) if r.period_id == req.period_id and r.id != req.id]
    return {
        "request": req,
        "period": period,
        "status": request_status(progress, req),
        "progress": progress,
        "shared_with": shared_with,
    }


# --- routes: health and profile -----------------------------------------------------

@app.get("/health")
def health():
    return {"ok": True, "model": settings.gemini_model, "vertex": settings.google_genai_use_vertexai}


@app.post("/suppliers", response_model=SupplierProfile)
def upsert_supplier(body: SupplierIn, caller: Caller = Depends(current_caller)):
    repo = get_repo()
    existing = repo.get_supplier(caller.uid)
    # Keep site ids stable across saves so bills uploaded earlier stay attached
    # to the same site: match by id, then by name.
    old_by_id = {s.id: s for s in existing.sites} if existing else {}
    old_by_name = {s.name.strip().lower(): s for s in existing.sites} if existing else {}
    sites = []
    for s in body.sites:
        prev = old_by_id.get(s.id or "") or old_by_name.get(s.name.strip().lower())
        keep = {}
        # Setup no longer asks for an address (it is entered where it is used, on the reduction page), so a
        # save that leaves it out keeps the stored address and its lookup; a changed address drops the lookup.
        address = s.address if s.address is not None else (prev.address if prev else None)
        if prev and (prev.address or "") == (address or ""):
            keep = {"lat": prev.lat, "lng": prev.lng, "formatted_address": prev.formatted_address}
        if prev:
            keep["roof_area_m2"] = prev.roof_area_m2
        sites.append(Site(id=prev.id if prev else f"site_{uuid.uuid4().hex[:6]}", name=s.name, country=s.country, region=s.region, address=address, **keep))
    sites = sites or [Site(id="main", name="Main site", country=body.country)]
    profile = SupplierProfile(
        id=caller.uid, name=body.name, country=body.country.upper(), language=body.language,
        fiscal_year_start=body.fiscal_year_start, fiscal_year_end=body.fiscal_year_end, sites=sites,
        sector=body.sector, revenue=body.revenue, revenue_currency=body.revenue_currency,
        headcount=body.headcount, nace_code=body.nace_code.strip(),
        created_at=existing.created_at if existing else datetime.now(UTC),
        email=caller.email or (existing.email if existing else None),
    )
    repo.put_supplier(profile)
    # A first-run supplier gets a period for the FY they just typed, so the
    # dashboard has a year to attach the first request to.
    if not repo.list_periods(caller.uid):
        default_period(repo, profile)
    return profile


@app.get("/suppliers/{supplier_id}", response_model=SupplierProfile)
def get_supplier(supplier_id: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    if caller.email and profile.email != caller.email:  # backfill suppliers created before the field existed
        profile = profile.model_copy(update={"email": caller.email})
        get_repo().put_supplier(profile)
    return profile


@app.delete("/suppliers/{supplier_id}/data")
def reset_supplier(supplier_id: str, caller: Caller = Depends(require_supplier)):
    """Drop every period, request, questionnaire and file. The profile stays."""
    profile = _profile_or_404(supplier_id)
    reset_all(get_repo(), profile)
    return {"scope": "all"}


# --- routes: home ---------------------------------------------------------------------

@app.get("/suppliers/{supplier_id}/home")
def home(supplier_id: str, caller: Caller = Depends(require_supplier)):
    """Everything the dashboard shows in one call: requests with derived status,
    and the reporting years behind them with coverage and totals."""
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    periods = repo.list_periods(supplier_id)
    requests = repo.list_requests(supplier_id)
    period_views = []
    for p in periods:
        lines = repo.list_activity_lines(supplier_id, p.id)
        state = repo.get_reconcile(supplier_id, p.id)
        _, snap = repo.list_inventory(supplier_id, p.id)
        issues = state.issue_objects() if state else []
        period_views.append({
            "period": p,
            "progress": period_progress(repo, supplier_id, p.id),
            "summary": summarise(lines, issues, state.dropped_outside_fy if state else [], p.start, p.end),
            "totals": snap.totals if snap else None,
            "used_by": [r.customer_name for r in requests if r.period_id == p.id],
        })
    return {
        "profile": profile,
        "periods": period_views,
        "requests": [_request_view(supplier_id, r) for r in requests],
    }


# --- routes: periods --------------------------------------------------------------------

@app.get("/suppliers/{supplier_id}/periods")
def list_periods(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return {"periods": get_repo().list_periods(supplier_id)}


@app.post("/suppliers/{supplier_id}/periods", response_model=ReportingPeriod)
def create_period(supplier_id: str, body: PeriodIn, caller: Caller = Depends(require_supplier)):
    _profile_or_404(supplier_id)
    if body.end <= body.start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The period must end after it starts.")
    repo = get_repo()
    for p in repo.list_periods(supplier_id):
        if p.start == body.start and p.end == body.end:
            return p
    p = make_period(body.start, body.end, body.label)
    repo.put_period(supplier_id, p)
    return p


@app.get("/suppliers/{supplier_id}/periods/{pid}")
def get_period(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    return {"period": _period_or_404(supplier_id, pid), "progress": period_progress(get_repo(), supplier_id, pid)}


@app.delete("/suppliers/{supplier_id}/periods/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_period_route(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    """Delete the reporting year with its bills, inventory, files and the requests made for it."""
    delete_period(get_repo(), _profile_or_404(supplier_id), _period_or_404(supplier_id, pid))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete("/suppliers/{supplier_id}/periods/{pid}/data")
def reset_period_data(supplier_id: str, pid: str, scope: str = "all", caller: Caller = Depends(require_supplier)):
    """scope=chat  keeps the bills; drops conversation, assumptions and inventory
                and rebuilds the lines from the stored extractions.
    scope=all   drops everything in the period, including stored files and the
                questionnaires of requests that used it."""
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    repo = get_repo()
    if scope == "chat":
        return {"scope": scope, "activity_lines": reset_questions(repo, profile, period)}
    if scope == "all":
        reset_period(repo, profile, period)
        return {"scope": scope, "activity_lines": 0}
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "scope must be 'chat' or 'all'")


# --- routes: requests ---------------------------------------------------------------------

@app.get("/suppliers/{supplier_id}/requests")
def list_requests(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return {"requests": [_request_view(supplier_id, r) for r in get_repo().list_requests(supplier_id)]}


@app.post("/suppliers/{supplier_id}/requests")
def create_request(supplier_id: str, body: RequestIn, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    if not body.customer_name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Who is asking? Give the customer a name.")
    if body.new_period:
        period = create_period(supplier_id, body.new_period, caller)
    elif body.period_id:
        period = _period_or_404(supplier_id, body.period_id)
    else:
        period = default_period(repo, profile)
    req = Request(
        id=f"req_{uuid.uuid4().hex[:8]}", customer_name=body.customer_name.strip(), period_id=period.id,
        due_date=body.due_date, customer_share=body.customer_share,
    )
    repo.put_request(supplier_id, req)
    return _request_view(supplier_id, req)


@app.get("/suppliers/{supplier_id}/requests/{rid}")
def get_request(supplier_id: str, rid: str, caller: Caller = Depends(require_supplier)):
    return _request_view(supplier_id, _request_or_404(supplier_id, rid))


@app.patch("/suppliers/{supplier_id}/requests/{rid}")
def patch_request(supplier_id: str, rid: str, body: RequestPatch, caller: Caller = Depends(require_supplier)):
    req = _request_or_404(supplier_id, rid)
    upd: dict = {"updated_at": datetime.now(UTC)}
    if body.customer_name is not None and body.customer_name.strip():
        upd["customer_name"] = body.customer_name.strip()
    if body.due_date is not None:
        upd["due_date"] = body.due_date
    if body.clear_due_date:
        upd["due_date"] = None
    if body.customer_share is not None:
        upd["customer_share"] = body.customer_share
    req = req.model_copy(update=upd)
    get_repo().put_request(supplier_id, req)
    return _request_view(supplier_id, req)


@app.post("/suppliers/{supplier_id}/requests/{rid}/template")
def upload_request_template(supplier_id: str, rid: str, file: UploadFile = File(...), caller: Caller = Depends(require_supplier)):
    """Attach the customer's questionnaire (xlsx) to the request before the bills are in."""
    req = _request_or_404(supplier_id, rid)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "The questionnaire must be an .xlsx workbook.")
    key = f"suppliers/{supplier_id}/requests/{rid}/template.xlsx"
    get_storage().put(key, file.file.read(), XLSX)
    req = req.model_copy(update={"template_key": key, "template_filename": file.filename, "updated_at": datetime.now(UTC)})
    get_repo().put_request(supplier_id, req)
    return _request_view(supplier_id, req)


@app.delete("/suppliers/{supplier_id}/requests/{rid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_request(supplier_id: str, rid: str, caller: Caller = Depends(require_supplier)):
    """Remove the request and its questionnaire. The period's bills and inventory
    stay: other requests may share them."""
    req = _request_or_404(supplier_id, rid)
    repo = get_repo()
    if req.questionnaire_id:
        repo.delete_questionnaire(supplier_id, req.questionnaire_id)
    get_storage().delete_prefix(f"suppliers/{supplier_id}/requests/{rid}/")
    repo.delete_request(supplier_id, rid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- routes: documents (period) -------------------------------------------------------------

@app.post("/suppliers/{supplier_id}/periods/{pid}/documents")
def upload_documents(
    supplier_id: str,
    pid: str,
    files: list[UploadFile] = File(...),
    site_id: str | None = Form(default=None),
    caller: Caller = Depends(require_supplier),
):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    repo = get_repo()
    out = []
    for f in files:
        data = f.file.read()
        mime = f.content_type or mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream"
        if not (mime.startswith("image/") or mime == "application/pdf"):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"{f.filename}: images and PDFs only")
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"{f.filename}: over 20 MB")
        out.append(register_and_extract(repo, profile, period, data=data, filename=f.filename or "upload", mime_type=mime, site_id=site_id))
    return {"documents": out}


@app.get("/suppliers/{supplier_id}/periods/{pid}/documents")
def list_documents(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    _period_or_404(supplier_id, pid)
    return {"documents": get_repo().list_documents(supplier_id, pid)}


@app.delete("/suppliers/{supplier_id}/periods/{pid}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(supplier_id: str, pid: str, doc_id: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    if not remove_document(get_repo(), profile, period, doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/suppliers/{supplier_id}/periods/{pid}/documents/{doc_id}/retry")
def retry_document(supplier_id: str, pid: str, doc_id: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    rec = retry_extraction(get_repo(), profile, period, doc_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return {"document": rec}


@app.get("/suppliers/{supplier_id}/periods/{pid}/documents/{doc_id}/file")
def document_file(supplier_id: str, pid: str, doc_id: str, caller: Caller = Depends(require_supplier)):
    rec = get_repo().get_document(supplier_id, pid, doc_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return _file_response(rec.storage_key, rec.filename)


@app.get("/suppliers/{supplier_id}/periods/{pid}/documents/{doc_id}/page/{page}")
def document_page(supplier_id: str, pid: str, doc_id: str, page: int = 1, caller: Caller = Depends(require_supplier)):
    """The bill as a PNG, so the browser can draw a printed value's box over it.
    Photos come back as they are (one page); PDFs are rendered page by page."""
    from .evidence import page_png

    rec = get_repo().get_document(supplier_id, pid, doc_id)
    storage = get_storage()
    if rec is None or not storage.exists(rec.storage_key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    try:
        png = page_png(storage.get(rec.storage_key), rec.mime_type, page)
    except Exception:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This document could not be rendered.")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


# --- routes: reconcile (period) --------------------------------------------------------------

def _reconcile_view(profile: SupplierProfile, period: ReportingPeriod, state: ReconcileState | None) -> dict:
    """The stored state plus a summary of what the checks found, computed on read.

    Before the first "Check my bills" the state is idle but the bills are
    already uploaded, so the summary still describes them (with no issues).
    """
    repo = get_repo()
    lines = repo.list_activity_lines(profile.id, period.id)
    state = state or ReconcileState(supplier_id=profile.id, period_id=period.id)
    summary = summarise(lines, state.issue_objects(), state.dropped_outside_fy, period.start, period.end)
    return state.model_dump(mode="json") | {"summary": summary}


def _in_app_language(profile: SupplierProfile, x_locale: str | None) -> SupplierProfile:
    """The questions are asked in the language the app is showing, which the browser sends as X-Locale."""
    if x_locale in reconciler.LANG_NAMES:
        return profile.model_copy(update={"language": x_locale})
    return profile


@app.post("/suppliers/{supplier_id}/periods/{pid}/reconcile/start")
def reconcile_start(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier), x_locale: str | None = Header(default=None)):
    profile = _in_app_language(_profile_or_404(supplier_id), x_locale)
    period = _period_or_404(supplier_id, pid)
    return _reconcile_view(profile, period, reconciler.start(get_repo(), profile, period))


@app.post("/suppliers/{supplier_id}/periods/{pid}/reconcile")
def reconcile_reply(supplier_id: str, pid: str, body: ReplyIn, caller: Caller = Depends(require_supplier), x_locale: str | None = Header(default=None)):
    profile = _in_app_language(_profile_or_404(supplier_id), x_locale)
    period = _period_or_404(supplier_id, pid)
    if not body.message.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say something first.")
    return _reconcile_view(profile, period, reconciler.reply(get_repo(), profile, period, body.message.strip()))


@app.get("/suppliers/{supplier_id}/periods/{pid}/reconcile")
def reconcile_state(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    return _reconcile_view(profile, period, get_repo().get_reconcile(supplier_id, pid))


# --- routes: inventory (period) ---------------------------------------------------------------

@app.post("/suppliers/{supplier_id}/periods/{pid}/compute")
def compute(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    return compute_inventory(get_repo(), profile, period)


@app.get("/suppliers/{supplier_id}/periods/{pid}/inventory")
def inventory(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    _period_or_404(supplier_id, pid)
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id, pid)
    return {
        "lines": lines,
        "snapshot": snap,
        "assumptions": repo.list_assumptions(supplier_id, pid),
        "activityLines": repo.list_activity_lines(supplier_id, pid),
    }


_suggest_log: dict[str, deque] = defaultdict(deque)     # uid -> times of recent suggestion requests (per instance)


def _suggest_budget(uid: str) -> None:
    """Each user gets a bounded number of Places requests per hour, so a script or a stuck client cannot run up the bill."""
    now = time.monotonic()
    q = _suggest_log[uid]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= settings.places_hourly_limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many address searches this hour. Type the full address and press Find on map.")
    q.append(now)


@app.get("/places/suggest")
def places_suggest(q: str = Query(default="", max_length=200), session: str = Query(default="", max_length=64),
                   country: str | None = Query(default=None, pattern="^[A-Za-z]{2}$"),
                   caller: Caller = Depends(current_caller), x_locale: str | None = Header(default=None)):
    """Address suggestions while the supplier types, inside their country. Needs 3+ characters and a session token."""
    if len(q.strip()) < 3:
        return {"suggestions": []}
    if not solar.valid_session(session):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing search session.")
    profile = get_repo().get_supplier(caller.uid)
    cc = country or (profile.country if profile else None)
    _suggest_budget(caller.uid)
    try:
        found = solar.suggest(q, cc, session, x_locale if x_locale in ("en", "vi", "ja") else None)
    except solar.SolarError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return {"suggestions": [{"place_id": s.place_id, "text": s.text, "main": s.main, "secondary": s.secondary} for s in found]}


@app.post("/suppliers/{supplier_id}/sites/{site_id}/locate", response_model=SupplierProfile)
def locate_site(supplier_id: str, site_id: str, body: LocateIn, caller: Caller = Depends(require_supplier)):
    """Pin a site on the map for the reduction advisor: from its address (geocoded), from coordinates,
    or just set the supplier's own roof area."""
    profile = _profile_or_404(supplier_id)
    site = next((s for s in profile.sites if s.id == site_id), None)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found.")
    upd: dict = {}
    typed = (body.address or "").strip()
    pasted = solar.parse_coordinates(typed) if typed else None     # "10.7290, 106.7190" copied from Google Maps
    if body.place_id:
        if not solar.valid_place_id(body.place_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That suggestion is not valid. Pick one again.")
        try:
            place = solar.place_details(body.place_id, body.session if solar.valid_session(body.session) else None)
        except solar.SolarError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
        if place is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "We could not open that suggestion. Search again or paste the roof's coordinates.")
        if place.too_broad:
            raise HTTPException(422, f"That is too broad ({place.formatted_address}). Add a street, building number and city, or choose a suggestion.")
        upd.update(address=place.formatted_address or typed, lat=place.lat, lng=place.lng, formatted_address=place.formatted_address,
                   location_precision="exact" if place.precise else "approximate")
    elif pasted is not None:
        upd.update(address=typed, lat=pasted[0], lng=pasted[1], formatted_address=f"{pasted[0]:.5f}, {pasted[1]:.5f}", location_precision="exact")
    elif typed:
        try:
            place = solar.geocode(typed, site.country or profile.country)
        except solar.SolarError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
        if place is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "We could not find that address. Add the building number, district and city, or paste the roof's coordinates from Google Maps.")
        if place.too_broad:
            raise HTTPException(422, f"That is too broad ({place.formatted_address}). Add a street, building number and city, or choose a suggestion.")
        upd.update(address=typed, lat=place.lat, lng=place.lng, formatted_address=place.formatted_address,
                   location_precision="exact" if place.precise else "approximate")
    elif body.lat is not None and body.lng is not None:
        upd.update(lat=body.lat, lng=body.lng, formatted_address=f"{body.lat:.5f}, {body.lng:.5f}", location_precision="exact")
    if body.roof_area_m2 is not None:
        upd["roof_area_m2"] = body.roof_area_m2
    if not upd:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give an address, coordinates or a roof area.")
    sites = [s.model_copy(update=upd) if s.id == site_id else s for s in profile.sites]
    profile = profile.model_copy(update={"sites": sites})
    get_repo().put_supplier(profile)
    return profile


@app.get("/suppliers/{supplier_id}/periods/{pid}/advisor")
def advisor(supplier_id: str, pid: str, site_id: str | None = None, caller: Caller = Depends(require_supplier)):
    """Where this site could cut emissions: rooftop solar sized to its own use, plus ranked levers."""
    profile = _profile_or_404(supplier_id)
    _period_or_404(supplier_id, pid)
    if site_id is not None and not any(s.id == site_id for s in profile.sites):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found.")
    try:
        return build_advice(get_repo(), profile, pid, site_id or default_site_id(profile))
    except LookupError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Compute the inventory before looking at reductions.")


@app.patch("/suppliers/{supplier_id}/periods/{pid}/activity-lines/{line_id}")
def patch_line(supplier_id: str, pid: str, line_id: str, body: LinePatch, caller: Caller = Depends(require_supplier)):
    """Inline correction from the inventory view. Recomputes so the numbers never drift from the lines."""
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    repo = get_repo()
    line = next((l for l in repo.list_activity_lines(supplier_id, pid) if l.id == line_id), None)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Line not found.")
    upd: dict = {}
    notes = [line.notes] if line.notes else []
    if body.quantity is not None and body.quantity != line.quantity:
        upd["quantity"] = body.quantity
        upd["tier"] = "secondary" if line.tier == "primary" else line.tier
        notes.append(f"corrected by supplier from {line.quantity:g} to {body.quantity:g}")
    if body.energy_type:
        upd["energy_type"] = body.energy_type
        notes.append(f"type corrected to {body.energy_type}")
    if body.site_id is not None:
        upd["site_id"] = body.site_id
    if body.note:
        notes.append(body.note)
    upd["notes"] = " | ".join(n for n in notes if n)
    upd["confidence"] = 1.0
    # The supplier has looked at this bill and decided; a failed self-check no longer stands.
    upd["checks"] = confirm_failed_checks(line).checks
    repo.update_activity_line(supplier_id, pid, line.model_copy(update=upd))
    snap = compute_inventory(repo, profile, period)
    return {"line": repo.list_activity_lines(supplier_id, pid), "snapshot": snap}


@app.get("/suppliers/{supplier_id}/periods/{pid}/methodology")
def methodology(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id, pid)
    if snap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Compute the inventory before generating the note.")
    state = repo.get_reconcile(supplier_id, pid)
    pdf = build_pdf(
        profile.for_period(period), snap, lines, repo.list_assumptions(supplier_id, pid),
        n_docs=len(repo.list_documents(supplier_id, pid)), dropped=len(state.dropped_outside_fy) if state else 0,
        evidence=build_evidence(repo, supplier_id, pid, lines),
    )
    key = f"{period_prefix(supplier_id, pid)}outputs/methodology-note.pdf"
    get_storage().put(key, pdf, "application/pdf")
    return {"download": f"/suppliers/{supplier_id}/periods/{pid}/methodology/file", "bytes": len(pdf)}


@app.get("/suppliers/{supplier_id}/periods/{pid}/methodology/file")
def methodology_file(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    return _file_response(f"{period_prefix(supplier_id, pid)}outputs/methodology-note.pdf", "methodology-note.pdf")


def _fact_context(supplier_id: str, pid: str, *, customer_share: float | None = None, customer_name: str = "") -> FactContext:
    """What every deterministic answer is computed from, for a period with a computed inventory."""
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id, pid)
    if snap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Compute the inventory first.")
    try:
        advice = build_advice(repo, profile, pid, default_site_id(profile))["advice"]
    except Exception:       # the draft reduction answer is a nicety; never block an answer on it
        advice = None
    return FactContext(
        profile.for_period(period), snap, lines, repo.list_assumptions(supplier_id, pid), customer_share, advice,
        previous_year_of(repo, supplier_id, period), customer_name,
    )


# --- routes: answer packs for portal questionnaires ---------------------------------------------------

def _pack_for(supplier_id: str, rid: str, bank_id: str):
    if bank_id not in PACK_BANKS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No answer pack for this questionnaire.")
    req = _request_or_404(supplier_id, rid)
    ctx = _fact_context(supplier_id, req.period_id, customer_share=req.customer_share, customer_name=req.customer_name)
    docs = {d.id: d.filename for d in get_repo().list_documents(supplier_id, req.period_id)}
    return build_pack(bank_id, ctx, docs=docs), ctx, docs


@app.get("/suppliers/{supplier_id}/packs")
def list_packs(supplier_id: str, caller: Caller = Depends(require_supplier)):
    """The questionnaires that are answered in a portal, for which we build an answer pack."""
    out = []
    for bid in PACK_BANKS:
        b = get_bank(bid)
        out.append({"id": b.id, "name": b.name, "publisher": b.publisher, "version": b.version, "questions": len(b.questions)})
    return {"packs": out}


@app.get("/suppliers/{supplier_id}/requests/{rid}/packs/{bank_id}")
def get_pack(supplier_id: str, rid: str, bank_id: str, caller: Caller = Depends(require_supplier)):
    pack, _, _ = _pack_for(supplier_id, rid, bank_id)
    base = f"/suppliers/{supplier_id}/requests/{rid}/packs/{bank_id}"
    return {"pack": pack, "counts": pack.counts, "downloads": {"xlsx": f"{base}/xlsx", "pdf": f"{base}/pdf"}}


@app.get("/suppliers/{supplier_id}/requests/{rid}/packs/{bank_id}/xlsx")
def pack_xlsx(supplier_id: str, rid: str, bank_id: str, caller: Caller = Depends(require_supplier)):
    pack, ctx, docs = _pack_for(supplier_id, rid, bank_id)
    return Response(
        content=to_xlsx(pack, ctx.lines, docs), media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{bank_id}-answer-pack.xlsx"'},
    )


@app.get("/suppliers/{supplier_id}/requests/{rid}/packs/{bank_id}/pdf")
def pack_pdf(supplier_id: str, rid: str, bank_id: str, caller: Caller = Depends(require_supplier)):
    pack, _, _ = _pack_for(supplier_id, rid, bank_id)
    return Response(
        content=to_pdf(pack), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{bank_id}-answer-pack.pdf"'},
    )


# --- routes: EFRAG VSME digital template ----------------------------------------------------------

@app.get("/suppliers/{supplier_id}/periods/{pid}/vsme")
def vsme(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    """EFRAG's own VSME Digital Template (B1, B3) filled from the inventory, plus what was left for the supplier."""
    try:
        res = fill_vsme(_fact_context(supplier_id, pid))
    except VsmeError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"The VSME template could not be filled: {e}")
    get_storage().put(f"{period_prefix(supplier_id, pid)}outputs/vsme-digital-template.xlsx", res.xlsx, XLSX)
    return {
        "download": f"/suppliers/{supplier_id}/periods/{pid}/vsme/file",
        "filled": [{"ref": f.ref, "cell": f.cell, "value": f.value, "source": f.source} for f in res.filled],
        "open_items": [{"ref": o.ref, "label": o.label, "reason": o.reason} for o in res.open_items],
    }


@app.get("/suppliers/{supplier_id}/periods/{pid}/vsme/file")
def vsme_file(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    return _file_response(f"{period_prefix(supplier_id, pid)}outputs/vsme-digital-template.xlsx", "VSME-Digital-Template-filled.xlsx")


# --- routes: questionnaire (request) --------------------------------------------------------------

@app.post("/suppliers/{supplier_id}/requests/{rid}/questionnaire")
def fill_request_questionnaire(
    supplier_id: str,
    rid: str,
    file: UploadFile | None = File(default=None),
    customer_share: float | None = Form(default=None),
    caller: Caller = Depends(require_supplier),
):
    """Fill the request's questionnaire from its period's inventory. The template
    comes with the call or from the one attached to the request; the share
    likewise. Refilling replaces the previous answers."""
    profile = _profile_or_404(supplier_id)
    req = _request_or_404(supplier_id, rid)
    period = _period_or_404(supplier_id, req.period_id)
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id, period.id)
    if snap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Compute the inventory before filling a questionnaire.")
    storage = get_storage()
    if file is not None:
        if not (file.filename or "").lower().endswith(".xlsx"):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "The questionnaire must be an .xlsx workbook.")
        template = file.file.read()
        template_key = f"suppliers/{supplier_id}/requests/{rid}/template.xlsx"
        storage.put(template_key, template, XLSX)
        req = req.model_copy(update={"template_key": template_key, "template_filename": file.filename})
    elif req.template_key and storage.exists(req.template_key):
        template, template_key = storage.get(req.template_key), req.template_key
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload the customer's questionnaire first.")
    share = customer_share if customer_share is not None else req.customer_share
    try:
        advice = build_advice(repo, profile, period.id, default_site_id(profile))["advice"]
    except Exception:       # the draft reduction answer is a nicety; never block the questionnaire on it
        advice = None
    try:
        filled, answers, offset = fill_workbook(
            template, profile=profile.for_period(period), snap=snap, lines=lines,
            assumptions=repo.list_assumptions(supplier_id, period.id), customer_share=share, advice=advice,
            previous=previous_year_of(repo, supplier_id, period), customer_name=req.customer_name,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    qid = f"q_{uuid.uuid4().hex[:8]}"
    stem = (req.template_filename or "questionnaire").rsplit(".", 1)[0]
    filled_key = f"suppliers/{supplier_id}/requests/{rid}/outputs/{qid}/{stem}-filled.xlsx"
    storage.put(filled_key, filled, XLSX)
    rec = QuestionnaireRecord(
        id=qid, supplier_id=supplier_id, request_id=rid, period_id=period.id, template_key=template_key,
        filled_key=filled_key, answers=[a.model_dump() for a in answers], answer_column_offset=offset, status="filled",
    )
    if req.questionnaire_id:
        repo.delete_questionnaire(supplier_id, req.questionnaire_id)
    repo.put_questionnaire(rec)
    req = req.model_copy(update={"questionnaire_id": qid, "customer_share": share, "updated_at": datetime.now(UTC)})
    repo.put_request(supplier_id, req)
    return {"questionnaire": rec, "request": _request_view(supplier_id, req), "download": f"/suppliers/{supplier_id}/questionnaire/{qid}/file"}


@app.get("/suppliers/{supplier_id}/requests/{rid}/questionnaire")
def get_request_questionnaire(supplier_id: str, rid: str, caller: Caller = Depends(require_supplier)):
    req = _request_or_404(supplier_id, rid)
    rec = get_repo().get_questionnaire(supplier_id, req.questionnaire_id) if req.questionnaire_id else None
    return {"questionnaire": rec}


@app.patch("/suppliers/{supplier_id}/questionnaire/{qid}/answers/{question_id}")
def edit_answer(supplier_id: str, qid: str, question_id: str, body: AnswerPatch, caller: Caller = Depends(require_supplier)):
    """The supplier types an answer the documents could not give (a target, a
    plan, Scope 3) or overrides drafted text. Calculator numbers are refused:
    those change by correcting the bill quantity in the inventory, so the
    lineage from document to cell stays intact. The workbook is rewritten
    from the stored template so the download always matches the screen."""
    _profile_or_404(supplier_id)
    repo = get_repo()
    rec = repo.get_questionnaire(supplier_id, qid)
    if rec is None or not rec.filled_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Questionnaire not found.")
    answers = [Answer.model_validate(a) for a in rec.answers]
    target = next((a for a in answers if a.question_id == question_id), None)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    if not target.editable or (target.field in LOCKED_FIELDS and not target.flagged):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This figure comes from the calculator. Correct the bill quantity in the inventory instead.")
    value = body.value.strip()
    if not value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Answer is empty.")
    if target.options:
        match = next((o for o in target.options if o.strip().lower() == value.lower()), None)
        if match is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This cell is a dropdown in the customer's sheet. Choose one of: " + ", ".join(target.options[:12]))
        value = match
    generated_previous = target.value if (not target.flagged and not target.edited) else None
    target.value = value
    target.flagged = False
    target.flag_reason = None
    target.edited = True
    target.source = (
        "entered by supplier" if generated_previous is None
        else f"edited by supplier; generated answer was: {generated_previous}"
    )
    storage = get_storage()
    template = storage.get(rec.template_key)
    filled = write_answers(template, answers, rec.answer_column_offset)
    storage.put(rec.filled_key, filled, XLSX)
    rec.answers = [a.model_dump() for a in answers]
    repo.put_questionnaire(rec)
    return {"questionnaire": rec}


@app.get("/suppliers/{supplier_id}/questionnaire/{qid}/file")
def questionnaire_file(supplier_id: str, qid: str, caller: Caller = Depends(require_supplier)):
    rec = get_repo().get_questionnaire(supplier_id, qid)
    if rec is None or not rec.filled_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Questionnaire not found.")
    return _file_response(rec.filled_key, rec.filled_key.rsplit("/", 1)[-1])
