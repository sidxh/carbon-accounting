"""Use-cases the API exposes, independent of HTTP.

Each function takes the repo, the supplier profile and the reporting period
it acts on. Keeping them here means the same code runs from a route, a
script, or a test.
"""

from __future__ import annotations

import uuid
from datetime import date

from .agents.extractor import ExtractedDocument, extract, to_activity_lines
from .calculator import compute
from .factor_library import get_library
from .models import InventoryLine, ReportingPeriod, Request, RequestStatus, SupplierProfile
from .repo import DocumentRecord, InventorySnapshot, Repo
from .storage import get_storage


def period_prefix(uid: str, pid: str) -> str:
    return f"suppliers/{uid}/periods/{pid}/"


# --- periods and requests -------------------------------------------------------

def make_period(start: date, end: date, label: str | None = None) -> ReportingPeriod:
    label = label or (f"FY{end.year}" if start.year == end.year else f"FY{start.year}/{str(end.year)[-2:]}")
    return ReportingPeriod(id=f"per_{uuid.uuid4().hex[:8]}", label=label, start=start, end=end)


def default_period(repo: Repo, profile: SupplierProfile) -> ReportingPeriod:
    """The period a first-run supplier gets from the FY on their profile; reused
    if one with the same dates already exists."""
    for p in repo.list_periods(profile.id):
        if p.start == profile.fiscal_year_start and p.end == profile.fiscal_year_end:
            return p
    p = make_period(profile.fiscal_year_start, profile.fiscal_year_end)
    repo.put_period(profile.id, p)
    return p


def period_progress(repo: Repo, uid: str, pid: str) -> dict:
    """What the period has reached, for gating the step flow.

    bills      an extracted document exists
    questions  the conversation finished, or an inventory exists
    inventory  a snapshot exists
    """
    docs = repo.list_documents(uid, pid)
    bills = any(d.status == "extracted" and (d.extraction or {}).get("lines") for d in docs)
    state = repo.get_reconcile(uid, pid)
    _, snap = repo.list_inventory(uid, pid)
    inventory = snap is not None
    questions = inventory or (state is not None and state.status == "done")
    return {"bills": bills, "questions": questions, "inventory": inventory, "documents": len(docs), "reconcile_status": state.status if state else "idle"}


def request_status(progress: dict, req: Request) -> RequestStatus:
    if req.questionnaire_id:
        return "filled"
    if progress["inventory"]:
        return "inventory"
    if progress["questions"]:
        return "questions"
    if progress["bills"]:
        return "bills"
    return "new"


# --- documents --------------------------------------------------------------------

def register_and_extract(
    repo: Repo,
    profile: SupplierProfile,
    period: ReportingPeriod,
    *,
    data: bytes,
    filename: str,
    mime_type: str,
    site_id: str | None,
) -> DocumentRecord:
    """Store an upload, read it with Gemini, and add its activity lines."""
    doc_id = f"doc_{uuid.uuid4().hex[:10]}"
    key = f"{period_prefix(profile.id, period.id)}uploads/{doc_id}/{filename}"
    get_storage().put(key, data, mime_type)

    site = site_id or (profile.sites[0].id if profile.sites else None)
    record = DocumentRecord(
        id=doc_id, supplier_id=profile.id, period_id=period.id, storage_key=key, filename=filename, mime_type=mime_type,
        site_id=site, status="extracting",
    )
    repo.put_document(record)
    try:
        extracted = extract(data, mime_type)
        lines = to_activity_lines(extracted, supplier_id=profile.id, source_doc_id=doc_id, site_id=site, country=profile.country)
        repo.add_activity_lines(profile.id, period.id, lines)
        record.status = "extracted"
        record.extraction = extracted.model_dump()
    except Exception as exc:  # keep the upload; surface the failure
        record.status = "failed"
        record.error = str(exc)[:500]
    repo.put_document(record)
    return record


def retry_extraction(repo: Repo, profile: SupplierProfile, period: ReportingPeriod, doc_id: str) -> DocumentRecord | None:
    """Read a stored bill again after a failed or empty extraction."""
    rec = repo.get_document(profile.id, period.id, doc_id)
    if rec is None:
        return None
    storage = get_storage()
    if not storage.exists(rec.storage_key):
        return None
    data = storage.get(rec.storage_key)
    # Drop whatever the previous attempt produced so lines are never doubled.
    repo.delete_document(profile.id, period.id, doc_id)
    rec.status, rec.error, rec.extraction = "extracting", None, None
    repo.put_document(rec)
    try:
        extracted = extract(data, rec.mime_type)
        lines = to_activity_lines(extracted, supplier_id=profile.id, source_doc_id=doc_id, site_id=rec.site_id, country=profile.country)
        repo.add_activity_lines(profile.id, period.id, lines)
        rec.status = "extracted"
        rec.extraction = extracted.model_dump()
    except Exception as exc:
        rec.status = "failed"
        rec.error = str(exc)[:500]
    repo.put_document(rec)
    return rec


def remove_document(repo: Repo, profile: SupplierProfile, period: ReportingPeriod, doc_id: str) -> bool:
    """Take a bill out again.

    Its lines go with it, the inventory snapshot is dropped because it no
    longer matches the lines, and the conversation goes back to idle so the
    next "Check my bills" re-runs the gap analysis. Chat history and answered
    assumptions are kept: the supplier's words are still true.
    """
    rec = repo.get_document(profile.id, period.id, doc_id)
    if rec is None:
        return False
    repo.delete_document(profile.id, period.id, doc_id)
    get_storage().delete_prefix(f"{period_prefix(profile.id, period.id)}uploads/{doc_id}/")
    _, snap = repo.list_inventory(profile.id, period.id)
    if snap is not None:
        repo.clear_inventory(profile.id, period.id)
    state = repo.get_reconcile(profile.id, period.id)
    if state is not None and state.status != "idle":
        state.status, state.pending_issue_id = "idle", None
        repo.put_reconcile(state)
    return True


# --- inventory ---------------------------------------------------------------------

def compute_inventory(repo: Repo, profile: SupplierProfile, period: ReportingPeriod) -> InventorySnapshot:
    """Factor selection and arithmetic over the reconciled lines; persists with lineage."""
    lines = repo.list_activity_lines(profile.id, period.id)
    region_by_site = {s.id: s.region for s in profile.sites}
    reporting_year = period.end.year
    result = compute(
        lines, get_library(), reporting_year=reporting_year, country=profile.country, region_by_site=region_by_site
    )
    snap = InventorySnapshot(
        supplier_id=profile.id,
        period_id=period.id,
        reporting_year=reporting_year,
        totals=result.totals,
        skipped=[[a, b] for a, b in result.skipped],
    )
    repo.replace_inventory(profile.id, period.id, result.lines, snap)
    return snap


# --- resets ------------------------------------------------------------------------

def reset_questions(repo: Repo, profile: SupplierProfile, period: ReportingPeriod) -> int:
    """Back to the moment the bills were read.

    Drops the chat, assumptions and inventory, then rebuilds the activity
    lines from the extraction stored on each document. That undoes everything
    the conversation did to the lines — estimated months, hour conversions,
    exclusions, inline corrections — so the same bills can be reconciled
    again with a different answer. Costs no model calls.
    """
    repo.clear_derived(profile.id, period.id)
    lines = []
    for rec in repo.list_documents(profile.id, period.id):
        if rec.status != "extracted" or not rec.extraction:
            continue
        doc = ExtractedDocument.model_validate(rec.extraction)
        lines.extend(to_activity_lines(doc, supplier_id=profile.id, source_doc_id=rec.id, site_id=rec.site_id, country=profile.country))
    repo.replace_activity_lines(profile.id, period.id, lines)
    return len(lines)


def reset_period(repo: Repo, profile: SupplierProfile, period: ReportingPeriod) -> None:
    """Remove every document, line, answer and inventory in one period. The
    period and the requests pointing at it stay; their questionnaires are
    dropped because the numbers behind them are gone."""
    repo.clear_period_data(profile.id, period.id)
    get_storage().delete_prefix(period_prefix(profile.id, period.id))
    for req in repo.list_requests(profile.id):
        if req.period_id == period.id and req.questionnaire_id:
            repo.delete_questionnaire(profile.id, req.questionnaire_id)
            repo.put_request(profile.id, req.model_copy(update={"questionnaire_id": None}))


def reset_all(repo: Repo, profile: SupplierProfile) -> None:
    """Remove every period, request, questionnaire and file. The profile stays."""
    repo.clear_supplier_data(profile.id)
    get_storage().delete_prefix(f"suppliers/{profile.id}/")


# --- evidence ----------------------------------------------------------------------

def _png_size(png: bytes) -> tuple[int, int]:
    import io

    from PIL import Image

    with Image.open(io.BytesIO(png)) as im:
        return im.size


def build_evidence(repo: Repo, uid: str, pid: str, lines: list[InventoryLine], *, limit: int = 36) -> list[dict]:
    """Cropped, outlined source snippets for the methodology note.

    One per headline inventory line (Scope 1, and Scope 2 location-based) whose
    document and printed-value box are known. Lines that came from an
    assumption, or whose bill could not be rendered, simply have no snippet.
    """
    import base64

    from .evidence import crop_evidence

    acts = {a.id: a for a in repo.list_activity_lines(uid, pid)}
    docs = {d.id: d for d in repo.list_documents(uid, pid)}
    storage = get_storage()
    out: list[dict] = []
    blobs: dict[str, bytes] = {}
    for l in sorted((x for x in lines if x.scope == 1 or x.basis == "location"), key=lambda x: (x.period_start, x.energy_type.value)):
        act, doc = acts.get(l.activity_line_id), docs.get(l.source_doc_id)
        if act is None or doc is None or not act.quantity_box:
            continue
        try:
            if doc.id not in blobs:
                blobs[doc.id] = storage.get(doc.storage_key)
            png = crop_evidence(blobs[doc.id], doc.mime_type, act.page, act.quantity_box)
        except Exception:
            continue
        out.append({
            "period": f"{l.period_start:%d %b} – {l.period_end:%d %b %Y}" if l.period_start != l.period_end else f"{l.period_start:%d %b %Y}",
            "carrier": l.energy_type.value.replace("_", " "),
            "quantity": f"{l.quantity:,.1f} {l.unit.value}",
            "filename": doc.filename,
            "png": base64.b64encode(png).decode(),
            "w": 420, "h": round(_png_size(png)[1] * 420 / _png_size(png)[0]),   # explicit size: the PDF engine misjudges tall images
        })
        if len(out) >= limit:
            break
    return out
