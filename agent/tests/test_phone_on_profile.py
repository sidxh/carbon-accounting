"""The verified phone number is copied onto the supplier document, for matching uids to people."""

from app import main
from app.auth import Caller, current_caller
from tests.test_api import PROFILE


def _as(phone):
    main.app.dependency_overrides[current_caller] = lambda: Caller(uid="sup-1", phone=phone)


def test_phone_is_saved_on_create_and_backfilled_on_read(client):
    try:
        _as(None)
        assert client.post("/suppliers", json=PROFILE).json()["phone"] is None
        _as("+918625008584")
        got = client.get("/suppliers/sup-1").json()
        assert got["phone"] == "+918625008584"
        assert client.repo.get_supplier("sup-1").phone == "+918625008584"
        # a later save without the claim keeps what is there
        _as(None)
        assert client.post("/suppliers", json=PROFILE).json()["phone"] == "+918625008584"
    finally:
        main.app.dependency_overrides.pop(current_caller, None)
