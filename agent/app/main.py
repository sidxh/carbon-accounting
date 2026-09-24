"""HTTP surface of the agent service.

Every route is scoped to the caller's own supplier record: the Firebase uid
in the ID token *is* the supplier id, and `require_supplier` refuses anything
else. Routes are plain `def` so FastAPI runs them in a worker thread — the
reconciler drives an ADK runner with `asyncio.run`, which needs to be outside
the server's event loop.
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
from .exporters.methodology import build_pdf
from .models import ActivityLine, Site, SupplierProfile
from .repo import QuestionnaireRecord, ReconcileState, get_repo
from .services import compute_inventory, register_and_extract, reset_all, reset_questions
from .settings import get_settings
from .storage import LocalStorage, get_storage

settings = get_settings()
app = FastAPI(title="Supplier carbon reporting agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# --- routes ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"ok": True, "model": settings.gemini_model, "vertex": settings.google_genai_use_vertexai}


@app.post("/suppliers", response_model=SupplierProfile)
def upsert_supplier(body: SupplierIn, caller: Caller = Depends(current_caller)):
    repo = get_repo()
    existing = repo.get_supplier(caller.uid)
    sites = [
        Site(id=s.id or f"site_{uuid.uuid4().hex[:6]}", name=s.name, country=s.country, region=s.region, address=s.address)
        for s in body.sites
    ] or [Site(id="main", name="Main site", country=body.country)]
    profile = SupplierProfile(
        id=caller.uid, name=body.name, country=body.country.upper(), language=body.language,
        fiscal_year_start=body.fiscal_year_start, fiscal_year_end=body.fiscal_year_end, sites=sites,
        sector=body.sector, revenue=body.revenue, revenue_currency=body.revenue_currency,
        created_at=existing.created_at if existing else datetime.now(timezone.utc),
    )
    repo.put_supplier(profile)
    return profile


@app.get("/suppliers/{supplier_id}", response_model=SupplierProfile)
def get_supplier(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return _profile_or_404(supplier_id)


@app.delete("/suppliers/{supplier_id}/data")
def reset_data(supplier_id: str, scope: str = "all", caller: Caller = Depends(require_supplier)):
    """Wipe the supplier's data so the same account can run the journey again.

    scope=chat  keeps the uploaded bills and their extractions; drops the
                conversation, assumptions and inventory and rebuilds the
                activity lines from the extractions.
    scope=all   drops everything except the profile, including stored files.
    """
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    if scope == "chat":
        return {"scope": scope, "activity_lines": reset_questions(repo, profile)}
    if scope == "all":
        reset_all(repo, profile)
        return {"scope": scope, "activity_lines": 0}
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "scope must be 'chat' or 'all'")


@app.post("/suppliers/{supplier_id}/documents")
def upload_documents(
    supplier_id: str,
    files: list[UploadFile] = File(...),
    site_id: str | None = Form(default=None),
    caller: Caller = Depends(require_supplier),
):
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    out = []
    for f in files:
        data = f.file.read()
        mime = f.content_type or mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream"
        if not (mime.startswith("image/") or mime == "application/pdf"):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"{f.filename}: images and PDFs only")
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"{f.filename}: over 20 MB")
        rec = register_and_extract(repo, profile, data=data, filename=f.filename or "upload", mime_type=mime, site_id=site_id)
        out.append(rec)
    return {"documents": out}


@app.get("/suppliers/{supplier_id}/documents")
def list_documents(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return {"documents": get_repo().list_documents(supplier_id)}


@app.get("/suppliers/{supplier_id}/documents/{doc_id}/file")
def document_file(supplier_id: str, doc_id: str, caller: Caller = Depends(require_supplier)):
    rec = get_repo().get_document(supplier_id, doc_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return _file_response(rec.storage_key, rec.filename)


@app.post("/suppliers/{supplier_id}/reconcile/start", response_model=ReconcileState)
def reconcile_start(supplier_id: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    return reconciler.start(get_repo(), profile)


@app.post("/suppliers/{supplier_id}/reconcile", response_model=ReconcileState)
def reconcile_reply(supplier_id: str, body: ReplyIn, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    if not body.message.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say something first.")
    return reconciler.reply(get_repo(), profile, body.message.strip())


@app.get("/suppliers/{supplier_id}/reconcile", response_model=ReconcileState | None)
def reconcile_state(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return get_repo().get_reconcile(supplier_id)


@app.post("/suppliers/{supplier_id}/compute")
def compute(supplier_id: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    snap = compute_inventory(get_repo(), profile)
    return snap


@app.get("/suppliers/{supplier_id}/inventory")
def inventory(supplier_id: str, caller: Caller = Depends(require_supplier)):
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id)
    return {
        "lines": lines,
        "snapshot": snap,
        "assumptions": repo.list_assumptions(supplier_id),
        "activityLines": repo.list_activity_lines(supplier_id),
    }


@app.patch("/suppliers/{supplier_id}/activity-lines/{line_id}")
def patch_line(supplier_id: str, line_id: str, body: LinePatch, caller: Caller = Depends(require_supplier)):
    """Inline correction from the inventory view. Recomputes so the numbers never drift from the lines."""
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    line = next((l for l in repo.list_activity_lines(supplier_id) if l.id == line_id), None)
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
    repo.update_activity_line(supplier_id, line.model_copy(update=upd))
    snap = compute_inventory(repo, profile)
    return {"line": repo.list_activity_lines(supplier_id), "snapshot": snap}


@app.post("/suppliers/{supplier_id}/questionnaire")
def questionnaire(
    supplier_id: str,
    file: UploadFile = File(...),
    customer_share: float | None = Form(default=None),
    caller: Caller = Depends(require_supplier),
):
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id)
    if snap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Compute the inventory before filling a questionnaire.")
    template = file.file.read()
    qid = f"q_{uuid.uuid4().hex[:8]}"
    storage = get_storage()
    template_key = f"suppliers/{supplier_id}/questionnaires/{qid}/template.xlsx"
    storage.put(template_key, template, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    try:
        filled, answers, offset = fill_workbook(
            template, profile=profile, snap=snap, lines=lines, assumptions=repo.list_assumptions(supplier_id),
            customer_share=customer_share,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    stem = (file.filename or "questionnaire").rsplit(".", 1)[0]
    filled_key = f"suppliers/{supplier_id}/outputs/{qid}/{stem}-filled.xlsx"
    storage.put(filled_key, filled, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    rec = QuestionnaireRecord(
        id=qid, supplier_id=supplier_id, template_key=template_key, filled_key=filled_key,
        answers=[a.model_dump() for a in answers], answer_column_offset=offset, status="filled",
    )
    repo.put_questionnaire(rec)
    return {"questionnaire": rec, "download": f"/suppliers/{supplier_id}/questionnaire/{qid}/file"}


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
    # Records filled before `editable` existed default to True; the field check covers them.
    if not target.editable or (target.field in LOCKED_FIELDS and not target.flagged):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This figure comes from the calculator. Correct the bill quantity in the inventory instead.")
    value = body.value.strip()
    if not value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Answer is empty.")
    # Only a generated answer is worth remembering; a supplier retyping their
    # own text is still just "entered by supplier".
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
    storage.put(rec.filled_key, filled, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    rec.answers = [a.model_dump() for a in answers]
    repo.put_questionnaire(rec)
    return {"questionnaire": rec}


@app.get("/suppliers/{supplier_id}/questionnaire")
def list_questionnaires(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return {"questionnaires": get_repo().list_questionnaires(supplier_id)}


@app.get("/suppliers/{supplier_id}/questionnaire/{qid}/file")
def questionnaire_file(supplier_id: str, qid: str, caller: Caller = Depends(require_supplier)):
    rec = get_repo().get_questionnaire(supplier_id, qid)
    if rec is None or not rec.filled_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Questionnaire not found.")
    return _file_response(rec.filled_key, rec.filled_key.rsplit("/", 1)[-1])


@app.get("/suppliers/{supplier_id}/methodology")
def methodology(supplier_id: str, caller: Caller = Depends(require_supplier)):
    profile = _profile_or_404(supplier_id)
    repo = get_repo()
    lines, snap = repo.list_inventory(supplier_id)
    if snap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Compute the inventory before generating the note.")
    state = repo.get_reconcile(supplier_id)
    pdf = build_pdf(
        profile, snap, lines, repo.list_assumptions(supplier_id),
        n_docs=len(repo.list_documents(supplier_id)), dropped=len(state.dropped_outside_fy) if state else 0,
    )
    key = f"suppliers/{supplier_id}/outputs/methodology-note.pdf"
    get_storage().put(key, pdf, "application/pdf")
    return {"download": f"/suppliers/{supplier_id}/methodology/file", "bytes": len(pdf)}


@app.get("/suppliers/{supplier_id}/methodology/file")
def methodology_file(supplier_id: str, caller: Caller = Depends(require_supplier)):
    return _file_response(f"suppliers/{supplier_id}/outputs/methodology-note.pdf", "methodology-note.pdf")
