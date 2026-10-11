"""The verified email is copied onto the supplier document, for matching uids to people."""

from app import main
from app.auth import Caller, current_caller
from tests.test_api import PROFILE


def _as(email):
    main.app.dependency_overrides[current_caller] = lambda: Caller(uid="sup-1", email=email)


def test_email_is_saved_on_create_and_backfilled_on_read(client):
    try:
        _as(None)
        assert client.post("/suppliers", json=PROFILE).json()["email"] is None
        _as("ops@minhphat.example")
        got = client.get("/suppliers/sup-1").json()
        assert got["email"] == "ops@minhphat.example"
        assert client.repo.get_supplier("sup-1").email == "ops@minhphat.example"
        # a later save without the claim keeps what is there
        _as(None)
        assert client.post("/suppliers", json=PROFILE).json()["email"] == "ops@minhphat.example"
    finally:
        main.app.dependency_overrides.pop(current_caller, None)
