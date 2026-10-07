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
import uuid
from datetime import date, datetime, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field

from .agents import reconciler
from .agents.filler import LOCKED_FIELDS, Answer, fill_workbook, write_answers
from .auth import Caller, current_caller, require_supplier
from .checks import confirm_failed_checks
from .exporters.methodology import build_pdf
from .models import ReportingPeriod, Request, Site, SupplierProfile
from .reconcile_tools import summarise
from .repo import QuestionnaireRecord, ReconcileState, get_repo
from .services import (
    build_evidence,
    compute_inventory,
    default_period,
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
from .storage import LocalStorage, get_storage

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
    if isinstance(storage, LocalStorage):
        data = storage.get(key)
        media = mimetypes.guess_type(key)[0] or "application/octet-stream"
        headers = {"Content-Disposition": f'inline; filename="{download_name or key.rsplit("/", 1)[-1]}"'}
        return Response(content=data, media_type=media, headers=headers)
    return RedirectResponse(storage.url(key))


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
        sites.append(Site(id=prev.id if prev else f"site_{uuid.uuid4().hex[:6]}", name=s.name, country=s.country, region=s.region, address=s.address))
    sites = sites or [Site(id="main", name="Main site", country=body.country)]
    profile = SupplierProfile(
        id=caller.uid, name=body.name, country=body.country.upper(), language=body.language,
        fiscal_year_start=body.fiscal_year_start, fiscal_year_end=body.fiscal_year_end, sites=sites,
        sector=body.sector, revenue=body.revenue, revenue_currency=body.revenue_currency,
        created_at=existing.created_at if existing else datetime.now(timezone.utc),
    )
    repo.put_supplier(profile)
    # A first-run supplier gets a period for the FY they just typed, so the
    # dashboard has a year to attach the first request to.
    if not repo.list_periods(caller.uid):
        default_period(repo, profile)
    return profile


@app.get("/suppliers/{supplier_id}", response_model=SupplierProfile)
def get_supplier(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return _profile_or_404(supplier_id)


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
    upd: dict = {"updated_at": datetime.now(timezone.utc)}
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
    req = req.model_copy(update={"template_key": key, "template_filename": file.filename, "updated_at": datetime.now(timezone.utc)})
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


@app.post("/suppliers/{supplier_id}/periods/{pid}/reconcile/start")
def reconcile_start(supplier_id: str, pid: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    period = _period_or_404(supplier_id, pid)
    return _reconcile_view(profile, period, reconciler.start(get_repo(), profile, period))


@app.post("/suppliers/{supplier_id}/periods/{pid}/reconcile")
def reconcile_reply(supplier_id: str, pid: str, body: ReplyIn, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
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
        filled, answers, offset = fill_workbook(
            template, profile=profile.for_period(period), snap=snap, lines=lines,
            assumptions=repo.list_assumptions(supplier_id, period.id), customer_share=share,
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
    req = req.model_copy(update={"questionnaire_id": qid, "customer_share": share, "updated_at": datetime.now(timezone.utc)})
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
