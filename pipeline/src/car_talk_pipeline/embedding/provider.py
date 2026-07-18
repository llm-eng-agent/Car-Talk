"""Embedding provider interface (spec section 10.5).

Isolates provider-specific code from retrieval/chunking. The POC implementation is OpenAI
``text-embedding-3-small``; the interface exists to avoid coupling, not because multiple
providers are implemented.
"""

from __future__ import annotations

from typing import Protocol


class EmbeddingError(Exception):
    """Raised when embedding fails or returns an invalid response."""


class EmbeddingProvider(Protocol):
    @property
    def dimensions(self) -> int: ...

    @property
    def model_version(self) -> str: ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, query: str) -> list[float]: ...
