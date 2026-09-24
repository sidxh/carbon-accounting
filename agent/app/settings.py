"""Configuration, read once from the environment and the repo-root .env.

Every knob that differs between zero-payment local development and a deployed
Cloud Run service lives here, so switching is an environment change and never
a code change.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
AGENT_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", AGENT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Gemini
    google_api_key: str = ""
    google_genai_use_vertexai: bool = False
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_rpm: int = 15
    gemini_rpd: int = 500
    gemini_cache_dir: Path = Path(".cache/gemini")

    # Firebase
    firebase_project_id: str = "fir-testing-f96b1"
    firestore_emulator_host: str = ""
    firebase_auth_emulator_host: str = ""
    firebase_storage_emulator_host: str = ""

    # Storage
    storage_backend: str = "local"  # local | gcs
    storage_bucket: str = ""
    local_storage_dir: Path = Path(".local_storage")

    # API
    auth_disabled: bool = False
    cors_origins: str = "http://localhost:3000"

    # Data
    factors_dir: Path = REPO_ROOT / "data" / "factors"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def resolve(self, p: Path) -> Path:
        return p if p.is_absolute() else (AGENT_ROOT / p)


@lru_cache
def get_settings() -> Settings:
    return Settings()
