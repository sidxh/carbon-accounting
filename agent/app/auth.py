"""Request authentication: a Firebase ID token on every route.

The supplier document id *is* the Firebase uid, so once the token verifies the
caller can only ever act on their own data — there is no separate ownership
check to forget.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth as fb_auth

from .firebase import get_app
from .settings import get_settings


@dataclass(frozen=True)
class Caller:
    uid: str
    email: str | None = None


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


async def current_caller(authorization: str | None = Header(default=None)) -> Caller:
    s = get_settings()
    token = _bearer(authorization)

    if s.auth_disabled:
        # Local-only escape hatch. The uid is taken from the token if one is
        # sent (so the emulator flow still works), otherwise a fixed dev user.
        return Caller(uid=token or "dev-supplier")

    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    try:
        get_app()
        decoded = fb_auth.verify_id_token(token)
    except Exception as exc:  # expired, malformed, wrong project
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session is not valid.") from exc

    return Caller(
        uid=decoded["uid"],
        email=decoded.get("email"),
    )


def require_supplier(supplier_id: str, caller: Caller = Depends(current_caller)) -> Caller:
    if caller.uid != supplier_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That is not your supplier record.")
    return caller
