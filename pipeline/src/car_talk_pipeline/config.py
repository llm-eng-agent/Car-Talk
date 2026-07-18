"""Configuration and secret loading for the pipeline.

Secrets come from environment variables / a git-ignored ``.env`` at the repo root
(spec section 20.5). Values are never logged.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# config.py -> car_talk_pipeline -> src -> pipeline -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ENV_PATH = REPO_ROOT / ".env"


class ConfigError(Exception):
    """Raised when required configuration is missing."""


@dataclass(frozen=True)
class Settings:
    """Validated runtime settings. Never log ``openai_api_key`` or ``qdrant_api_key``.

    ``openai_api_key`` is empty on the indexing-only path (``load_settings(require_openai=
    False)``), which reads cached vectors and never calls OpenAI.
    """

    openai_api_key: str
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    # Qdrant Cloud is only needed by the indexing step; absent values are fine for
    # scrape/embed. ``require_qdrant`` validates them at the point of use.
    qdrant_url: str | None = None
    qdrant_api_key: str | None = None
    qdrant_collection: str = "car_review_chunks_v1"


def load_settings(env_path: Path | None = None, *, require_openai: bool = True) -> Settings:
    """Load and validate settings from the environment / ``.env``.

    Qdrant values are read when present but not required here — validated at the point of use
    by ``require_qdrant``. ``OPENAI_API_KEY`` is required unless ``require_openai`` is False
    (the indexing-only path reads cached vectors and never calls OpenAI).

    Raises:
        ConfigError: If ``require_openai`` and ``OPENAI_API_KEY`` is missing or empty.
    """

    import os

    load_dotenv(env_path or DEFAULT_ENV_PATH)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if require_openai and not api_key:
        raise ConfigError(
            "OPENAI_API_KEY is not set. Add it to the repo-root .env (see .env.example)."
        )
    return Settings(
        openai_api_key=api_key,
        qdrant_url=os.environ.get("QDRANT_URL", "").strip() or None,
        qdrant_api_key=os.environ.get("QDRANT_API_KEY", "").strip() or None,
        qdrant_collection=os.environ.get("QDRANT_COLLECTION", "").strip() or "car_review_chunks_v1",
    )


def require_qdrant(settings: Settings) -> tuple[str, str, str]:
    """Return ``(url, api_key, collection)``, raising if any Qdrant value is missing.

    Called only by the indexing step so scrape/embed stay runnable without Qdrant.

    Raises:
        ConfigError: If ``QDRANT_URL`` or ``QDRANT_API_KEY`` is missing.
    """

    if not settings.qdrant_url or not settings.qdrant_api_key:
        raise ConfigError(
            "QDRANT_URL and QDRANT_API_KEY must be set for indexing. "
            "Add them to the repo-root .env (see .env.example)."
        )
    return settings.qdrant_url, settings.qdrant_api_key, settings.qdrant_collection
