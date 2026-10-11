"""Persistence for everything a supplier accumulates.

Firestore layout, all under the supplier the Firebase uid names:

    suppliers/{uid}                         SupplierProfile
      periods/{pid}                         ReportingPeriod
        documents/{docId}                   upload metadata + raw extraction
        activityLines/{lineId}              reconciled lines (what compute reads)
        assumptions/{asmId}
        inventoryLines/{lineId}             calculator output with lineage
        inventory/snapshot
        reconcile/state                     ReconcileState (issues, chat, status)
      requests/{rid}                        Request (a customer asking for numbers)
      questionnaires/{qId}                  filled workbook + answers, owned by a request

Bills, the conversation and the inventory belong to a reporting period; a
request points at a period and owns only its questionnaire. Two customers
asking for FY2025 share one set of bills and one inventory.

`MemoryRepo` has the same surface for tests and for running the pipeline
without an emulator.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from .models import ActivityLine, Assumption, InventoryLine, InventoryTotals, ReportingPeriod, Request, SupplierProfile
from .reconcile_tools import Issue


class DocumentRecord(BaseModel):
    id: str
    supplier_id: str
    period_id: str = ""
    storage_key: str
    filename: str
    mime_type: str
    site_id: str | None = None
    status: str = "uploaded"  # uploaded | extracting | extracted | failed
    extraction: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChatTurn(BaseModel):
    role: str  # user | agent
    text: str
    at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ReconcileState(BaseModel):
    supplier_id: str
    period_id: str = ""
    status: str = "idle"  # idle | asking | done
    issues: list[dict[str, Any]] = Field(default_factory=list)
    pending_issue_id: str | None = None
    history: list[ChatTurn] = Field(default_factory=list)
    dropped_outside_fy: list[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def issue_objects(self) -> list[Issue]:
        from .models import EnergyType

        out = []
        for i in self.issues:
            d = dict(i)
            if isinstance(d.get("energy_type"), str):
                d["energy_type"] = EnergyType(d["energy_type"])
            out.append(Issue(**d))
        return out

    def set_issues(self, issues: list[Issue]) -> None:
        self.issues = [
            dict(i.__dict__) | {"energy_type": (str(i.energy_type.value) if i.energy_type else None)}
            for i in issues
        ]


class InventorySnapshot(BaseModel):
    supplier_id: str
    period_id: str = ""
    reporting_year: int
    totals: InventoryTotals
    skipped: list[list[str]] = Field(default_factory=list)
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class QuestionnaireRecord(BaseModel):
    id: str
    supplier_id: str
    request_id: str | None = None
    period_id: str = ""
    template_key: str
    filled_key: str | None = None
    answers: list[dict[str, Any]] = Field(default_factory=list)
    answer_column_offset: int = 1
    status: str = "uploaded"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Repo(ABC):
    # suppliers
    @abstractmethod
    def get_supplier(self, uid: str) -> SupplierProfile | None: ...
    @abstractmethod
    def put_supplier(self, p: SupplierProfile) -> None: ...

    # periods
    @abstractmethod
    def list_periods(self, uid: str) -> list[ReportingPeriod]: ...
    @abstractmethod
    def get_period(self, uid: str, pid: str) -> ReportingPeriod | None: ...
    @abstractmethod
    def put_period(self, uid: str, p: ReportingPeriod) -> None: ...
    @abstractmethod
    def delete_period(self, uid: str, pid: str) -> None:
        """Remove the period record. Its data goes first, with `clear_period_data`."""

    # requests
    @abstractmethod
    def list_requests(self, uid: str) -> list[Request]: ...
    @abstractmethod
    def get_request(self, uid: str, rid: str) -> Request | None: ...
    @abstractmethod
    def put_request(self, uid: str, r: Request) -> None: ...
    @abstractmethod
    def delete_request(self, uid: str, rid: str) -> None: ...

    # documents (period-scoped)
    @abstractmethod
    def put_document(self, d: DocumentRecord) -> None: ...
    @abstractmethod
    def get_document(self, uid: str, pid: str, doc_id: str) -> DocumentRecord | None: ...
    @abstractmethod
    def list_documents(self, uid: str, pid: str) -> list[DocumentRecord]: ...
    @abstractmethod
    def delete_document(self, uid: str, pid: str, doc_id: str) -> None:
        """Remove the document and every activity line that came from it."""

    # activity lines (raw from extraction, then replaced by reconciled set)
    @abstractmethod
    def list_activity_lines(self, uid: str, pid: str) -> list[ActivityLine]: ...
    @abstractmethod
    def replace_activity_lines(self, uid: str, pid: str, lines: list[ActivityLine]) -> None: ...
    @abstractmethod
    def add_activity_lines(self, uid: str, pid: str, lines: list[ActivityLine]) -> None: ...
    @abstractmethod
    def update_activity_line(self, uid: str, pid: str, line: ActivityLine) -> None: ...

    # assumptions
    @abstractmethod
    def list_assumptions(self, uid: str, pid: str) -> list[Assumption]: ...
    @abstractmethod
    def add_assumption(self, uid: str, pid: str, a: Assumption) -> None: ...

    # reconcile state
    @abstractmethod
    def get_reconcile(self, uid: str, pid: str) -> ReconcileState | None: ...
    @abstractmethod
    def put_reconcile(self, s: ReconcileState) -> None: ...

    # inventory
    @abstractmethod
    def replace_inventory(self, uid: str, pid: str, lines: list[InventoryLine], snap: InventorySnapshot) -> None: ...
    @abstractmethod
    def list_inventory(self, uid: str, pid: str) -> tuple[list[InventoryLine], InventorySnapshot | None]: ...
    @abstractmethod
    def clear_inventory(self, uid: str, pid: str) -> None: ...

    # questionnaires (supplier-scoped, tagged with request and period)
    @abstractmethod
    def put_questionnaire(self, q: QuestionnaireRecord) -> None: ...
    @abstractmethod
    def get_questionnaire(self, uid: str, qid: str) -> QuestionnaireRecord | None: ...
    @abstractmethod
    def list_questionnaires(self, uid: str) -> list[QuestionnaireRecord]: ...
    @abstractmethod
    def delete_questionnaire(self, uid: str, qid: str) -> None: ...

    # reset
    @abstractmethod
    def clear_derived(self, uid: str, pid: str) -> None:
        """Drop everything the reconciler and calculator produced for a period:
        chat state, assumptions, inventory lines and snapshot. Documents and
        activity lines stay."""

    @abstractmethod
    def clear_period_data(self, uid: str, pid: str) -> None:
        """Drop everything under a period; the period record itself stays."""

    @abstractmethod
    def clear_supplier_data(self, uid: str) -> None:
        """Drop periods, requests and questionnaires; the profile stays."""


# --- Firestore ---------------------------------------------------------------

PERIOD_COLLECTIONS = ["reconcile", "assumptions", "inventoryLines", "inventory", "activityLines", "documents"]


class FirestoreRepo(Repo):
    def __init__(self, db):
        self.db = db

    def _sup(self, uid: str):
        return self.db.collection("suppliers").document(uid)

    def _per(self, uid: str, pid: str):
        return self._sup(uid).collection("periods").document(pid)

    @staticmethod
    def _dump(m: BaseModel) -> dict:
        return m.model_dump(mode="json")

    def _delete_all(self, refs) -> None:
        # Firestore batches cap at 500 writes; commit in chunks.
        batch, n = self.db.batch(), 0
        for ref in refs:
            batch.delete(ref)
            n += 1
            if n >= 400:
                batch.commit()
                batch, n = self.db.batch(), 0
        if n:
            batch.commit()

    # suppliers
    def get_supplier(self, uid):
        snap = self._sup(uid).get()
        return SupplierProfile.model_validate(snap.to_dict()) if snap.exists else None

    def put_supplier(self, p):
        self._sup(p.id).set(self._dump(p))

    # periods
    def list_periods(self, uid):
        return sorted((ReportingPeriod.model_validate(s.to_dict()) for s in self._sup(uid).collection("periods").stream()), key=lambda p: p.start, reverse=True)

    def get_period(self, uid, pid):
        snap = self._per(uid, pid).get()
        return ReportingPeriod.model_validate(snap.to_dict()) if snap.exists else None

    def put_period(self, uid, p):
        self._per(uid, p.id).set(self._dump(p))

    def delete_period(self, uid, pid):
        self._per(uid, pid).delete()

    # requests
    def list_requests(self, uid):
        return sorted((Request.model_validate(s.to_dict()) for s in self._sup(uid).collection("requests").stream()), key=lambda r: r.created_at, reverse=True)

    def get_request(self, uid, rid):
        snap = self._sup(uid).collection("requests").document(rid).get()
        return Request.model_validate(snap.to_dict()) if snap.exists else None

    def put_request(self, uid, r):
        self._sup(uid).collection("requests").document(r.id).set(self._dump(r))

    def delete_request(self, uid, rid):
        self._sup(uid).collection("requests").document(rid).delete()

    # documents
    def put_document(self, d):
        self._per(d.supplier_id, d.period_id).collection("documents").document(d.id).set(self._dump(d))

    def get_document(self, uid, pid, doc_id):
        snap = self._per(uid, pid).collection("documents").document(doc_id).get()
        return DocumentRecord.model_validate(snap.to_dict()) if snap.exists else None

    def list_documents(self, uid, pid):
        return [DocumentRecord.model_validate(s.to_dict()) for s in self._per(uid, pid).collection("documents").stream()]

    def delete_document(self, uid, pid, doc_id):
        per = self._per(uid, pid)
        refs = [per.collection("documents").document(doc_id)]
        refs += [s.reference for s in per.collection("activityLines").where("source_doc_id", "==", doc_id).stream()]
        self._delete_all(refs)

    # activity lines
    def list_activity_lines(self, uid, pid):
        return [ActivityLine.model_validate(s.to_dict()) for s in self._per(uid, pid).collection("activityLines").stream()]

    def replace_activity_lines(self, uid, pid, lines):
        col = self._per(uid, pid).collection("activityLines")
        self._delete_all(s.reference for s in col.stream())
        self.add_activity_lines(uid, pid, lines)

    def add_activity_lines(self, uid, pid, lines):
        col = self._per(uid, pid).collection("activityLines")
        batch, n = self.db.batch(), 0
        for l in lines:
            batch.set(col.document(l.id), self._dump(l))
            n += 1
            if n >= 400:
                batch.commit()
                batch, n = self.db.batch(), 0
        if n:
            batch.commit()

    def update_activity_line(self, uid, pid, line):
        self._per(uid, pid).collection("activityLines").document(line.id).set(self._dump(line))

    # assumptions
    def list_assumptions(self, uid, pid):
        return [Assumption.model_validate(s.to_dict()) for s in self._per(uid, pid).collection("assumptions").stream()]

    def add_assumption(self, uid, pid, a):
        self._per(uid, pid).collection("assumptions").document(a.id).set(self._dump(a))

    # reconcile
    def get_reconcile(self, uid, pid):
        snap = self._per(uid, pid).collection("reconcile").document("state").get()
        return ReconcileState.model_validate(snap.to_dict()) if snap.exists else None

    def put_reconcile(self, s):
        self._per(s.supplier_id, s.period_id).collection("reconcile").document("state").set(self._dump(s))

    # inventory
    def replace_inventory(self, uid, pid, lines, snap):
        per = self._per(uid, pid)
        col = per.collection("inventoryLines")
        self._delete_all(s.reference for s in col.stream())
        batch, n = self.db.batch(), 0
        for l in lines:
            batch.set(col.document(l.id.replace("/", "_")), self._dump(l))
            n += 1
            if n >= 400:
                batch.commit()
                batch, n = self.db.batch(), 0
        batch.set(per.collection("inventory").document("snapshot"), self._dump(snap))
        batch.commit()

    def list_inventory(self, uid, pid):
        per = self._per(uid, pid)
        lines = [InventoryLine.model_validate(s.to_dict()) for s in per.collection("inventoryLines").stream()]
        snap = per.collection("inventory").document("snapshot").get()
        return lines, (InventorySnapshot.model_validate(snap.to_dict()) if snap.exists else None)

    def clear_inventory(self, uid, pid):
        self._clear_period_collections(uid, pid, ["inventoryLines", "inventory"])

    # questionnaires
    def put_questionnaire(self, q):
        self._sup(q.supplier_id).collection("questionnaires").document(q.id).set(self._dump(q))

    def get_questionnaire(self, uid, qid):
        snap = self._sup(uid).collection("questionnaires").document(qid).get()
        return QuestionnaireRecord.model_validate(snap.to_dict()) if snap.exists else None

    def list_questionnaires(self, uid):
        return [QuestionnaireRecord.model_validate(s.to_dict()) for s in self._sup(uid).collection("questionnaires").stream()]

    def delete_questionnaire(self, uid, qid):
        self._sup(uid).collection("questionnaires").document(qid).delete()

    # reset
    def _clear_period_collections(self, uid: str, pid: str, names: list[str]) -> None:
        per = self._per(uid, pid)
        self._delete_all(s.reference for name in names for s in per.collection(name).stream())

    def clear_derived(self, uid, pid):
        self._clear_period_collections(uid, pid, ["reconcile", "assumptions", "inventoryLines", "inventory"])

    def clear_period_data(self, uid, pid):
        self._clear_period_collections(uid, pid, PERIOD_COLLECTIONS)

    def clear_supplier_data(self, uid):
        for p in self.list_periods(uid):
            self.clear_period_data(uid, p.id)
            self._per(uid, p.id).delete()
        self._delete_all(s.reference for s in self._sup(uid).collection("requests").stream())
        self._delete_all(s.reference for s in self._sup(uid).collection("questionnaires").stream())


# --- in-memory ---------------------------------------------------------------

class MemoryRepo(Repo):
    def __init__(self):
        self.suppliers: dict[str, SupplierProfile] = {}
        self.periods: dict[str, dict[str, ReportingPeriod]] = {}
        self.requests: dict[str, dict[str, Request]] = {}
        self.documents: dict[tuple[str, str], dict[str, DocumentRecord]] = {}
        self.lines: dict[tuple[str, str], dict[str, ActivityLine]] = {}
        self.assumptions: dict[tuple[str, str], dict[str, Assumption]] = {}
        self.reconcile: dict[tuple[str, str], ReconcileState] = {}
        self.inventory: dict[tuple[str, str], tuple[list[InventoryLine], InventorySnapshot]] = {}
        self.questionnaires: dict[str, dict[str, QuestionnaireRecord]] = {}

    def get_supplier(self, uid):
        return self.suppliers.get(uid)

    def put_supplier(self, p):
        self.suppliers[p.id] = p

    def list_periods(self, uid):
        return sorted(self.periods.get(uid, {}).values(), key=lambda p: p.start, reverse=True)

    def get_period(self, uid, pid):
        return self.periods.get(uid, {}).get(pid)

    def put_period(self, uid, p):
        self.periods.setdefault(uid, {})[p.id] = p

    def delete_period(self, uid, pid):
        self.periods.get(uid, {}).pop(pid, None)

    def list_requests(self, uid):
        return sorted(self.requests.get(uid, {}).values(), key=lambda r: r.created_at, reverse=True)

    def get_request(self, uid, rid):
        return self.requests.get(uid, {}).get(rid)

    def put_request(self, uid, r):
        self.requests.setdefault(uid, {})[r.id] = r

    def delete_request(self, uid, rid):
        self.requests.get(uid, {}).pop(rid, None)

    def put_document(self, d):
        self.documents.setdefault((d.supplier_id, d.period_id), {})[d.id] = d

    def get_document(self, uid, pid, doc_id):
        return self.documents.get((uid, pid), {}).get(doc_id)

    def list_documents(self, uid, pid):
        return list(self.documents.get((uid, pid), {}).values())

    def delete_document(self, uid, pid, doc_id):
        self.documents.get((uid, pid), {}).pop(doc_id, None)
        self.lines[(uid, pid)] = {k: v for k, v in self.lines.get((uid, pid), {}).items() if v.source_doc_id != doc_id}

    def list_activity_lines(self, uid, pid):
        return list(self.lines.get((uid, pid), {}).values())

    def replace_activity_lines(self, uid, pid, lines):
        self.lines[(uid, pid)] = {l.id: l for l in lines}

    def add_activity_lines(self, uid, pid, lines):
        self.lines.setdefault((uid, pid), {}).update({l.id: l for l in lines})

    def update_activity_line(self, uid, pid, line):
        self.lines.setdefault((uid, pid), {})[line.id] = line

    def list_assumptions(self, uid, pid):
        return list(self.assumptions.get((uid, pid), {}).values())

    def add_assumption(self, uid, pid, a):
        self.assumptions.setdefault((uid, pid), {})[a.id] = a

    def get_reconcile(self, uid, pid):
        return self.reconcile.get((uid, pid))

    def put_reconcile(self, s):
        self.reconcile[(s.supplier_id, s.period_id)] = s

    def replace_inventory(self, uid, pid, lines, snap):
        self.inventory[(uid, pid)] = (lines, snap)

    def list_inventory(self, uid, pid):
        return self.inventory.get((uid, pid), ([], None))

    def clear_inventory(self, uid, pid):
        self.inventory.pop((uid, pid), None)

    def put_questionnaire(self, q):
        self.questionnaires.setdefault(q.supplier_id, {})[q.id] = q

    def get_questionnaire(self, uid, qid):
        return self.questionnaires.get(uid, {}).get(qid)

    def list_questionnaires(self, uid):
        return list(self.questionnaires.get(uid, {}).values())

    def delete_questionnaire(self, uid, qid):
        self.questionnaires.get(uid, {}).pop(qid, None)

    def clear_derived(self, uid, pid):
        self.reconcile.pop((uid, pid), None)
        self.assumptions.pop((uid, pid), None)
        self.inventory.pop((uid, pid), None)

    def clear_period_data(self, uid, pid):
        self.clear_derived(uid, pid)
        self.documents.pop((uid, pid), None)
        self.lines.pop((uid, pid), None)

    def clear_supplier_data(self, uid):
        for pid in list(self.periods.get(uid, {})):
            self.clear_period_data(uid, pid)
        self.periods.pop(uid, None)
        self.requests.pop(uid, None)
        self.questionnaires.pop(uid, None)


_repo: Repo | None = None


def get_repo() -> Repo:
    global _repo
    if _repo is None:
        from .settings import get_settings

        s = get_settings()
        if s.storage_backend == "memory":
            _repo = MemoryRepo()
        else:
            from .firebase import get_db

            _repo = FirestoreRepo(get_db())
    return _repo


def set_repo(r: Repo) -> None:
    global _repo
    _repo = r
