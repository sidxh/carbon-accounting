"""One Gemini client for the whole service, with the two things the free tier
forces on us and a deployed service still benefits from:

* a rate limiter that respects the project's RPM and RPD so a batch never
  trips a 429 storm, with the daily count persisted across restarts;
* an on-disk response cache keyed on everything that determines the answer,
  so re-running the golden-set evaluation costs no quota and is reproducible.

Structured calls go through `generate_structured`, which passes a Pydantic
model as `response_schema` so the model cannot return free text.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from .settings import get_settings

T = TypeVar("T", bound=BaseModel)


class QuotaExhausted(RuntimeError):
    """Raised when today's request allowance is used up rather than waiting hours."""


class _RateLimiter:
    def __init__(self, rpm: int, rpd: int, state_file: Path):
        self.rpm = rpm
        self.rpd = rpd
        self.state_file = state_file
        self._minute: deque[float] = deque()
        self._lock = threading.Lock()
        self._day, self._count = self._load()

    def _load(self) -> tuple[str, int]:
        try:
            d = json.loads(self.state_file.read_text())
            if d.get("day") == date.today().isoformat():
                return d["day"], int(d["count"])
        except Exception:
            pass
        return date.today().isoformat(), 0

    def _save(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps({"day": self._day, "count": self._count}))

    def acquire(self) -> None:
        with self._lock:
            today = date.today().isoformat()
            if today != self._day:
                self._day, self._count = today, 0
            if self._count >= self.rpd:
                raise QuotaExhausted(
                    f"Daily Gemini quota of {self.rpd} requests reached; resets at midnight Pacific."
                )
            now = time.monotonic()
            while self._minute and now - self._minute[0] > 60:
                self._minute.popleft()
            if len(self._minute) >= self.rpm:
                sleep_for = 60 - (now - self._minute[0]) + 0.25
                time.sleep(max(sleep_for, 0))
                now = time.monotonic()
                while self._minute and now - self._minute[0] > 60:
                    self._minute.popleft()
            self._minute.append(now)
            self._count += 1
            self._save()

    @property
    def used_today(self) -> int:
        return self._count


@dataclass
class ImagePart:
    data: bytes
    mime_type: str


class GeminiClient:
    def __init__(self) -> None:
        s = get_settings()
        if s.google_genai_use_vertexai:
            self.client = genai.Client(
                vertexai=True, project=s.google_cloud_project, location=s.google_cloud_location
            )
        else:
            if not s.google_api_key:
                raise RuntimeError("GOOGLE_API_KEY is not set and Vertex mode is off.")
            self.client = genai.Client(api_key=s.google_api_key)
        self.model = s.gemini_model
        self.cache_dir = s.resolve(s.gemini_cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.limiter = _RateLimiter(s.gemini_rpm, s.gemini_rpd, self.cache_dir / "_quota.json")

    # -- cache -------------------------------------------------------------

    def _key(self, model: str, prompt: str, images: list[ImagePart], schema: dict | None) -> str:
        h = hashlib.sha256()
        h.update(model.encode())
        h.update(b"\x00")
        h.update(prompt.encode())
        for im in images:
            h.update(b"\x00")
            h.update(im.mime_type.encode())
            h.update(hashlib.sha256(im.data).digest())
        if schema is not None:
            h.update(b"\x00")
            h.update(json.dumps(schema, sort_keys=True).encode())
        return h.hexdigest()

    def _cache_get(self, key: str) -> str | None:
        p = self.cache_dir / f"{key}.json"
        if p.exists():
            return json.loads(p.read_text())["text"]
        return None

    def _cache_put(self, key: str, text: str) -> None:
        (self.cache_dir / f"{key}.json").write_text(json.dumps({"text": text}))

    # -- calls -------------------------------------------------------------

    def _contents(self, prompt: str, images: list[ImagePart]) -> list[Any]:
        parts: list[Any] = [types.Part.from_bytes(data=im.data, mime_type=im.mime_type) for im in images]
        parts.append(types.Part.from_text(text=prompt))
        return parts

    def generate_text(
        self,
        prompt: str,
        *,
        images: list[ImagePart] | None = None,
        system: str | None = None,
        model: str | None = None,
        use_cache: bool = True,
    ) -> str:
        images = images or []
        model = model or self.model
        full_prompt = (system + "\n\n" if system else "") + prompt
        key = self._key(model, full_prompt, images, None)
        if use_cache and (hit := self._cache_get(key)) is not None:
            return hit
        self.limiter.acquire()
        resp = self.client.models.generate_content(
            model=model,
            contents=self._contents(prompt, images),
            config=types.GenerateContentConfig(system_instruction=system) if system else None,
        )
        text = resp.text or ""
        if use_cache:
            self._cache_put(key, text)
        return text

    def generate_structured(
        self,
        prompt: str,
        schema: type[T],
        *,
        images: list[ImagePart] | None = None,
        system: str | None = None,
        model: str | None = None,
        use_cache: bool = True,
    ) -> T:
        images = images or []
        model = model or self.model
        full_prompt = (system + "\n\n" if system else "") + prompt
        schema_json = schema.model_json_schema()
        key = self._key(model, full_prompt, images, schema_json)
        if use_cache and (hit := self._cache_get(key)) is not None:
            return schema.model_validate_json(hit)
        self.limiter.acquire()
        resp = self.client.models.generate_content(
            model=model,
            contents=self._contents(prompt, images),
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        text = resp.text or "{}"
        parsed = schema.model_validate_json(text)
        if use_cache:
            self._cache_put(key, parsed.model_dump_json())
        return parsed


_client: GeminiClient | None = None


def get_gemini() -> GeminiClient:
    global _client
    if _client is None:
        _client = GeminiClient()
    return _client
