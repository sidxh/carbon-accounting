"""Signed download links on Cloud Run: the signing credential must carry the cloud-platform scope."""

from __future__ import annotations

from types import SimpleNamespace

import google.auth

from app.storage import GcsStorage


class _FakeBlob:
    def __init__(self):
        self.kwargs = None

    def generate_signed_url(self, **kw):
        self.kwargs = kw
        return "https://signed.example/obj"


class _FakeCreds:
    valid = False
    token = None
    service_account_email = "default"

    def refresh(self, request):
        self.valid, self.token, self.service_account_email = True, "tok", "agent@proj.iam.gserviceaccount.com"


def _storage(blob: _FakeBlob) -> GcsStorage:
    st = GcsStorage.__new__(GcsStorage)
    st.client = SimpleNamespace(_credentials=SimpleNamespace())  # no `signer`: metadata-style credential
    st.bucket = SimpleNamespace(blob=lambda key: blob)
    return st


def test_url_signs_through_iam_with_cloud_platform_scope(monkeypatch):
    seen = {}

    def fake_default(scopes=None):
        seen["scopes"] = scopes
        return _FakeCreds(), "proj"

    monkeypatch.setattr(google.auth, "default", fake_default)
    blob = _FakeBlob()
    url = _storage(blob).url("suppliers/u/a.png")

    assert url == "https://signed.example/obj"
    assert seen["scopes"] == ["https://www.googleapis.com/auth/cloud-platform"]
    assert blob.kwargs["service_account_email"] == "agent@proj.iam.gserviceaccount.com"
    assert blob.kwargs["access_token"] == "tok"
    assert blob.kwargs["version"] == "v4"


def test_url_with_key_file_signs_locally(monkeypatch):
    blob = _FakeBlob()
    st = _storage(blob)
    st.client = SimpleNamespace(_credentials=SimpleNamespace(signer=object()))
    monkeypatch.setattr(google.auth, "default", lambda scopes=None: (_ for _ in ()).throw(AssertionError("must not call ADC")))
    st.url("k")
    assert "access_token" not in blob.kwargs
