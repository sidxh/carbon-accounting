"""Persistence for everything a supplier accumulates.

Firestore layout, all under the supplier the Firebase uid names:

    suppliers/{uid}                       SupplierProfile
      documents/{docId}                   upload metadata + raw extraction
      activityLines/{lineId}              reconciled lines (what compute reads)
      assumptions/{asmId}
      inventoryLines/{lineId}             calculator output with lineage
      questionnaires/{qId}
      reconcile/state                     ReconcileState (issues, chat, status)

`MemoryRepo` has the same surface for tests and for running the pipeline
without an emulator.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from .models import ActivityLine, Assumption, InventoryLine, InventoryTotals, SupplierProfile
from .reconcile_tools import Issue


class DocumentRecord(BaseModel):
    id: str
    supplier_id: str
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
    reporting_year: int
    totals: InventoryTotals
    skipped: list[list[str]] = Field(default_factory=list)
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class QuestionnaireRecord(BaseModel):
    id: str
    supplier_id: str
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

    # documents
    @abstractmethod
    def put_document(self, d: DocumentRecord) -> None: ...
    @abstractmethod
    def get_document(self, uid: str, doc_id: str) -> DocumentRecord | None: ...
    @abstractmethod
    def list_documents(self, uid: str) -> list[DocumentRecord]: ...

    # activity lines (raw from extraction, then replaced by reconciled set)
    @abstractmethod
    def list_activity_lines(self, uid: str) -> list[ActivityLine]: ...
    @abstractmethod
    def replace_activity_lines(self, uid: str, lines: list[ActivityLine]) -> None: ...
    @abstractmethod
    def add_activity_lines(self, uid: str, lines: list[ActivityLine]) -> None: ...
    @abstractmethod
    def update_activity_line(self, uid: str, line: ActivityLine) -> None: ...

    # assumptions
    @abstractmethod
    def list_assumptions(self, uid: str) -> list[Assumption]: ...
    @abstractmethod
    def add_assumption(self, uid: str, a: Assumption) -> None: ...

    # reconcile state
    @abstractmethod
    def get_reconcile(self, uid: str) -> ReconcileState | None: ...
    @abstractmethod
    def put_reconcile(self, s: ReconcileState) -> None: ...

    # inventory
    @abstractmethod
    def replace_inventory(self, uid: str, lines: list[InventoryLine], snap: InventorySnapshot) -> None: ...
    @abstractmethod
    def list_inventory(self, uid: str) -> tuple[list[InventoryLine], InventorySnapshot | None]: ...

    # questionnaires
    @abstractmethod
    def put_questionnaire(self, q: QuestionnaireRecord) -> None: ...
    @abstractmethod
    def get_questionnaire(self, uid: str, qid: str) -> QuestionnaireRecord | None: ...
    @abstractmethod
    def list_questionnaires(self, uid: str) -> list[QuestionnaireRecord]: ...

    # reset
    @abstractmethod
    def clear_derived(self, uid: str) -> None:
        """Drop everything the reconciler and calculator produced: chat state,
        assumptions, inventory lines and snapshot. Documents and activity lines stay."""

    @abstractmethod
    def clear_supplier_data(self, uid: str) -> None:
        """Drop everything under the supplier except the profile itself."""


# --- Firestore ---------------------------------------------------------------

class FirestoreRepo(Repo):
    def __init__(self, db):
        self.db = db

    def _sup(self, uid: str):
        return self.db.collection("suppliers").document(uid)

    @staticmethod
    def _dump(m: BaseModel) -> dict:
        return m.model_dump(mode="json")

    def get_supplier(self, uid):
        snap = self._sup(uid).get()
        return SupplierProfile.model_validate(snap.to_dict()) if snap.exists else None

    def put_supplier(self, p):
        self._sup(p.id).set(self._dump(p))

    def put_document(self, d):
        self._sup(d.supplier_id).collection("documents").document(d.id).set(self._dump(d))

    def get_document(self, uid, doc_id):
        snap = self._sup(uid).collection("documents").document(doc_id).get()
        return DocumentRecord.model_validate(snap.to_dict()) if snap.exists else None

    def list_documents(self, uid):
        return [DocumentRecord.model_validate(s.to_dict()) for s in self._sup(uid).collection("documents").stream()]

    def list_activity_lines(self, uid):
        return [ActivityLine.model_validate(s.to_dict()) for s in self._sup(uid).collection("activityLines").stream()]

    def replace_activity_lines(self, uid, lines):
        col = self._sup(uid).collection("activityLines")
        batch = self.db.batch()
        for s in col.stream():
            batch.delete(s.reference)
        for l in lines:
            batch.set(col.document(l.id), self._dump(l))
        batch.commit()

    def add_activity_lines(self, uid, lines):
        col = self._sup(uid).collection("activityLines")
        batch = self.db.batch()
        for l in lines:
            batch.set(col.document(l.id), self._dump(l))
        batch.commit()

    def update_activity_line(self, uid, line):
        self._sup(uid).collection("activityLines").document(line.id).set(self._dump(line))

    def list_assumptions(self, uid):
        return [Assumption.model_validate(s.to_dict()) for s in self._sup(uid).collection("assumptions").stream()]

    def add_assumption(self, uid, a):
        self._sup(uid).collection("assumptions").document(a.id).set(self._dump(a))

    def get_reconcile(self, uid):
        snap = self._sup(uid).collection("reconcile").document("state").get()
        return ReconcileState.model_validate(snap.to_dict()) if snap.exists else None

    def put_reconcile(self, s):
        self._sup(s.supplier_id).collection("reconcile").document("state").set(self._dump(s))

    def replace_inventory(self, uid, lines, snap):
        col = self._sup(uid).collection("inventoryLines")
        batch = self.db.batch()
        for s in col.stream():
            batch.delete(s.reference)
        for l in lines:
            batch.set(col.document(l.id.replace("/", "_")), self._dump(l))
        batch.set(self._sup(uid).collection("inventory").document("snapshot"), self._dump(snap))
        batch.commit()

    def list_inventory(self, uid):
        lines = [InventoryLine.model_validate(s.to_dict()) for s in self._sup(uid).collection("inventoryLines").stream()]
        snap = self._sup(uid).collection("inventory").document("snapshot").get()
        return lines, (InventorySnapshot.model_validate(snap.to_dict()) if snap.exists else None)

    def put_questionnaire(self, q):
        self._sup(q.supplier_id).collection("questionnaires").document(q.id).set(self._dump(q))

    def get_questionnaire(self, uid, qid):
        snap = self._sup(uid).collection("questionnaires").document(qid).get()
        return QuestionnaireRecord.model_validate(snap.to_dict()) if snap.exists else None

    def list_questionnaires(self, uid):
        return [QuestionnaireRecord.model_validate(s.to_dict()) for s in self._sup(uid).collection("questionnaires").stream()]

    def _delete_collections(self, uid: str, names: list[str]) -> None:
        # Firestore batches cap at 500 writes; commit in chunks.
        batch, n = self.db.batch(), 0
        for name in names:
            for s in self._sup(uid).collection(name).stream():
                batch.delete(s.reference)
                n += 1
                if n >= 400:
                    batch.commit()
                    batch, n = self.db.batch(), 0
        if n:
            batch.commit()

    def clear_derived(self, uid):
        self._delete_collections(uid, ["reconcile", "assumptions", "inventoryLines", "inventory"])

    def clear_supplier_data(self, uid):
        self._delete_collections(
            uid, ["reconcile", "assumptions", "inventoryLines", "inventory", "activityLines", "documents", "questionnaires"]
        )


# --- in-memory ---------------------------------------------------------------

class MemoryRepo(Repo):
    def __init__(self):
        self.suppliers: dict[str, SupplierProfile] = {}
        self.documents: dict[str, dict[str, DocumentRecord]] = {}
        self.lines: dict[str, dict[str, ActivityLine]] = {}
        self.assumptions: dict[str, dict[str, Assumption]] = {}
        self.reconcile: dict[str, ReconcileState] = {}
        self.inventory: dict[str, tuple[list[InventoryLine], InventorySnapshot]] = {}
        self.questionnaires: dict[str, dict[str, QuestionnaireRecord]] = {}

    def get_supplier(self, uid):
        return self.suppliers.get(uid)

    def put_supplier(self, p):
        self.suppliers[p.id] = p

    def put_document(self, d):
        self.documents.setdefault(d.supplier_id, {})[d.id] = d

    def get_document(self, uid, doc_id):
        return self.documents.get(uid, {}).get(doc_id)

    def list_documents(self, uid):
        return list(self.documents.get(uid, {}).values())

    def list_activity_lines(self, uid):
        return list(self.lines.get(uid, {}).values())

    def replace_activity_lines(self, uid, lines):
        self.lines[uid] = {l.id: l for l in lines}

    def add_activity_lines(self, uid, lines):
        self.lines.setdefault(uid, {}).update({l.id: l for l in lines})

    def update_activity_line(self, uid, line):
        self.lines.setdefault(uid, {})[line.id] = line

    def list_assumptions(self, uid):
        return list(self.assumptions.get(uid, {}).values())

    def add_assumption(self, uid, a):
        self.assumptions.setdefault(uid, {})[a.id] = a

    def get_reconcile(self, uid):
        return self.reconcile.get(uid)

    def put_reconcile(self, s):
        self.reconcile[s.supplier_id] = s

    def replace_inventory(self, uid, lines, snap):
        self.inventory[uid] = (lines, snap)

    def list_inventory(self, uid):
        return self.inventory.get(uid, ([], None))

    def put_questionnaire(self, q):
        self.questionnaires.setdefault(q.supplier_id, {})[q.id] = q

    def get_questionnaire(self, uid, qid):
        return self.questionnaires.get(uid, {}).get(qid)

    def list_questionnaires(self, uid):
        return list(self.questionnaires.get(uid, {}).values())

    def clear_derived(self, uid):
        self.reconcile.pop(uid, None)
        self.assumptions.pop(uid, None)
        self.inventory.pop(uid, None)

    def clear_supplier_data(self, uid):
        self.clear_derived(uid)
        self.documents.pop(uid, None)
        self.lines.pop(uid, None)
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
