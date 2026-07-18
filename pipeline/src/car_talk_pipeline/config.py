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
    """Validated runtime settings. Never log ``openai_api_key``."""

    openai_api_key: str
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536


def load_settings(env_path: Path | None = None) -> Settings:
    """Load and validate settings from the environment / ``.env``.

    Raises:
        ConfigError: If ``OPENAI_API_KEY`` is missing or empty.
    """

    import os

    load_dotenv(env_path or DEFAULT_ENV_PATH)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ConfigError(
            "OPENAI_API_KEY is not set. Add it to the repo-root .env (see .env.example)."
        )
    return Settings(openai_api_key=api_key)
