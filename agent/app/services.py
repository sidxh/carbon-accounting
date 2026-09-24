"""Use-cases the API exposes, independent of HTTP.

Each function takes the repo and a supplier profile and does one thing the
web app asks for. Keeping them here means the same code runs from a route, a
script, or a test.
"""

from __future__ import annotations

import uuid

from .agents.extractor import ExtractedDocument, extract, to_activity_lines
from .calculator import compute
from .factor_library import get_library
from .models import SupplierProfile
from .repo import DocumentRecord, InventorySnapshot, Repo
from .storage import get_storage


def register_and_extract(
    repo: Repo,
    profile: SupplierProfile,
    *,
    data: bytes,
    filename: str,
    mime_type: str,
    site_id: str | None,
) -> DocumentRecord:
    """Store an upload, read it with Gemini, and add its activity lines."""
    doc_id = f"doc_{uuid.uuid4().hex[:10]}"
    key = f"suppliers/{profile.id}/uploads/{doc_id}/{filename}"
    get_storage().put(key, data, mime_type)

    site = site_id or (profile.sites[0].id if profile.sites else None)
    record = DocumentRecord(
        id=doc_id, supplier_id=profile.id, storage_key=key, filename=filename, mime_type=mime_type,
        site_id=site, status="extracting",
    )
    repo.put_document(record)
    try:
        extracted = extract(data, mime_type)
        lines = to_activity_lines(extracted, supplier_id=profile.id, source_doc_id=doc_id, site_id=site)
        repo.add_activity_lines(profile.id, lines)
        record.status = "extracted"
        record.extraction = extracted.model_dump()
    except Exception as exc:  # keep the upload; surface the failure
        record.status = "failed"
        record.error = str(exc)[:500]
    repo.put_document(record)
    return record


def compute_inventory(repo: Repo, profile: SupplierProfile) -> InventorySnapshot:
    """Factor selection and arithmetic over the reconciled lines; persists with lineage."""
    lines = repo.list_activity_lines(profile.id)
    region_by_site = {s.id: s.region for s in profile.sites}
    reporting_year = profile.fiscal_year_end.year
    result = compute(
        lines, get_library(), reporting_year=reporting_year, country=profile.country, region_by_site=region_by_site
    )
    snap = InventorySnapshot(
        supplier_id=profile.id,
        reporting_year=reporting_year,
        totals=result.totals,
        skipped=[[a, b] for a, b in result.skipped],
    )
    repo.replace_inventory(profile.id, result.lines, snap)
    return snap


def reset_questions(repo: Repo, profile: SupplierProfile) -> int:
    """Back to the moment the bills were read.

    Drops the chat, assumptions and inventory, then rebuilds the activity
    lines from the extraction stored on each document. That undoes everything
    the conversation did to the lines — estimated months, hour conversions,
    exclusions, inline corrections — so the same bills can be reconciled
    again with a different answer. Costs no model calls.
    """
    repo.clear_derived(profile.id)
    lines = []
    for rec in repo.list_documents(profile.id):
        if rec.status != "extracted" or not rec.extraction:
            continue
        doc = ExtractedDocument.model_validate(rec.extraction)
        lines.extend(to_activity_lines(doc, supplier_id=profile.id, source_doc_id=rec.id, site_id=rec.site_id))
    repo.replace_activity_lines(profile.id, lines)
    return len(lines)


def reset_all(repo: Repo, profile: SupplierProfile) -> None:
    """Remove every document, line, answer and output. The profile stays."""
    repo.clear_supplier_data(profile.id)
    get_storage().delete_prefix(f"suppliers/{profile.id}/")
