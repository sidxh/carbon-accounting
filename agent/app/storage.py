"""Object storage behind one small interface.

`LocalStorage` writes under agent/.local_storage so the whole pipeline runs
with no cloud account. `GcsStorage` is the production path. Both hand back a
URL the web app can fetch; locally that is served by the API itself.
"""

from __future__ import annotations

import mimetypes
import shutil
from abc import ABC, abstractmethod
from datetime import timedelta
from pathlib import Path

from .settings import get_settings


class Storage(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str | None = None) -> None: ...

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def url(self, key: str) -> str: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None: ...


class LocalStorage(Storage):
    def __init__(self, root: Path, public_base: str = "/files"):
        self.root = root
        self.public_base = public_base
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("storage key escapes root")
        return p

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def url(self, key: str) -> str:
        return f"{self.public_base}/{key}"

    def copy_in(self, src: Path, key: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, p)

    def delete_prefix(self, prefix: str) -> None:
        p = self._path(prefix.rstrip("/"))
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()


class GcsStorage(Storage):
    def __init__(self, bucket: str):
        from google.cloud import storage as gcs

        self.client = gcs.Client()
        self.bucket = self.client.bucket(bucket)

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        blob = self.bucket.blob(key)
        blob.upload_from_string(
            data, content_type=content_type or mimetypes.guess_type(key)[0] or "application/octet-stream"
        )

    def get(self, key: str) -> bytes:
        return self.bucket.blob(key).download_as_bytes()

    def exists(self, key: str) -> bool:
        return self.bucket.blob(key).exists()

    def url(self, key: str) -> str:
        blob = self.bucket.blob(key)
        creds = self.client._credentials
        if hasattr(creds, "signer"):  # a service-account key file
            return blob.generate_signed_url(expiration=timedelta(hours=6), version="v4")
        # Cloud Run's metadata credentials hold no private key, so ask the IAM API to sign.
        # The service account needs roles/iam.serviceAccountTokenCreator on itself.
        import google.auth.transport.requests

        creds.refresh(google.auth.transport.requests.Request())
        return blob.generate_signed_url(
            expiration=timedelta(hours=6), version="v4",
            service_account_email=creds.service_account_email, access_token=creds.token,
        )

    def delete_prefix(self, prefix: str) -> None:
        for blob in self.client.list_blobs(self.bucket, prefix=prefix):
            blob.delete()


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        if s.storage_backend == "gcs":
            _storage = GcsStorage(s.storage_bucket)
        else:
            _storage = LocalStorage(s.resolve(s.local_storage_dir))
    return _storage
