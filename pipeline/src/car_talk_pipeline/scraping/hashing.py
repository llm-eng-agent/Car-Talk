"""SHA-256 hashing helpers for ingestion idempotency (spec section 5, Locked Contract)."""

from __future__ import annotations

import hashlib


def sha256_text(text: str) -> str:
    """Return the hex SHA-256 of ``text`` encoded as UTF-8."""

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    """Return the hex SHA-256 of raw bytes (used for raw HTML)."""

    return hashlib.sha256(data).hexdigest()
