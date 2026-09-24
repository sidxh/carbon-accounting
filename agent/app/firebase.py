"""Firebase Admin initialisation.

Emulator hosts are honoured through the standard environment variables the
Admin SDK reads (`FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`), so
the same code talks to local emulators in development and to real Firebase in
production without a branch.
"""

from __future__ import annotations

import os
from functools import lru_cache

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore import Client as FirestoreClient

from .settings import get_settings


def _export_emulator_env() -> None:
    s = get_settings()
    if s.firestore_emulator_host:
        os.environ.setdefault("FIRESTORE_EMULATOR_HOST", s.firestore_emulator_host)
    if s.firebase_auth_emulator_host:
        os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", s.firebase_auth_emulator_host)
    if s.firebase_storage_emulator_host:
        os.environ.setdefault("STORAGE_EMULATOR_HOST", f"http://{s.firebase_storage_emulator_host}")


@lru_cache
def get_app() -> firebase_admin.App:
    _export_emulator_env()
    s = get_settings()
    if firebase_admin._apps:
        return firebase_admin.get_app()
    # Against the emulators no real credential is needed; in production ADC on
    # Cloud Run supplies one. ApplicationDefault handles both because the
    # emulator env vars make the SDK skip token exchange.
    try:
        cred = credentials.ApplicationDefault()
    except Exception:  # pragma: no cover - only when no ADC and no emulator
        cred = None
    options = {"projectId": s.firebase_project_id}
    if s.storage_bucket:
        options["storageBucket"] = s.storage_bucket
    return firebase_admin.initialize_app(cred, options)


@lru_cache
def get_db() -> FirestoreClient:
    get_app()
    return firestore.client()
