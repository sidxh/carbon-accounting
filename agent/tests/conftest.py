import pytest
from fastapi.testclient import TestClient

from app.repo import MemoryRepo, set_repo


@pytest.fixture
def client(monkeypatch):
    from app import settings as s

    s.get_settings.cache_clear()
    monkeypatch.setenv("AUTH_DISABLED", "TRUE")
    monkeypatch.setenv("STORAGE_BACKEND", "memory")
    from app import main

    repo = MemoryRepo()
    set_repo(repo)
    from app import storage as st
    st._storage = None
    c = TestClient(main.app)
    c.repo = repo
    yield c
    s.get_settings.cache_clear()
