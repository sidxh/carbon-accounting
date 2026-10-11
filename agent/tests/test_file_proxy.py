"""Files are always streamed through the agent: a redirect to storage breaks the browser fetch (no CORS there)."""

import pytest
from fastapi import HTTPException

from app import main, storage as st


class _CloudLikeStorage(st.Storage):
    """Not a LocalStorage: stands in for Cloud Storage."""

    def __init__(self):
        self.files = {"suppliers/u/methodology-note.pdf": b"%PDF-1.4 hello"}

    def put(self, key, data, content_type=None):
        self.files[key] = data

    def get(self, key):
        return self.files[key]

    def exists(self, key):
        return key in self.files

    def url(self, key):
        raise AssertionError("must not sign or redirect")

    def delete_prefix(self, prefix):
        pass


def test_cloud_storage_files_are_returned_not_redirected(monkeypatch):
    monkeypatch.setattr(main, "get_storage", lambda: _CloudLikeStorage())
    res = main._file_response("suppliers/u/methodology-note.pdf", "methodology-note.pdf")
    assert res.status_code == 200
    assert res.body == b"%PDF-1.4 hello"
    assert res.media_type == "application/pdf"
    assert "location" not in res.headers
    assert 'filename="methodology-note.pdf"' in res.headers["content-disposition"]


def test_missing_file_is_404(monkeypatch):
    monkeypatch.setattr(main, "get_storage", lambda: _CloudLikeStorage())
    with pytest.raises(HTTPException) as e:
        main._file_response("nope.pdf")
    assert e.value.status_code == 404
