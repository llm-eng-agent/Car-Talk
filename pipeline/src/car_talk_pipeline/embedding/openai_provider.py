"""OpenAI dense embedding provider (``text-embedding-3-small``, 1536 dims, cosine)."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .provider import EmbeddingError

if TYPE_CHECKING:
    from openai import OpenAI

logger = logging.getLogger(__name__)

EMBEDDING_TIMEOUT_SECONDS = 10.0
MAX_RETRIES = 2
DEFAULT_BATCH_SIZE = 100


class OpenAIEmbeddingProvider:
    """Embeds text via the OpenAI embeddings API.

    Retries transient errors with the SDK's built-in exponential backoff. Validates that
    every returned vector has the expected dimension before use (spec: validate external
    responses).
    """

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-3-small",
        dimensions: int = 1536,
        batch_size: int = DEFAULT_BATCH_SIZE,
        client: OpenAI | None = None,
    ) -> None:
        self._model = model
        self._dimensions = dimensions
        self._batch_size = batch_size
        if client is not None:
            self._client = client
        else:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=api_key,
                timeout=EMBEDDING_TIMEOUT_SECONDS,
                max_retries=MAX_RETRIES,
            )

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def model_version(self) -> str:
        return self._model

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            vectors.extend(self._embed_batch(batch))
        return vectors

    def embed_query(self, query: str) -> list[float]:
        return self._embed_batch([query])[0]

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        if not batch:
            return []
        try:
            response = self._client.embeddings.create(
                model=self._model,
                input=batch,
                dimensions=self._dimensions,
            )
        except Exception as error:
            raise EmbeddingError(f"OpenAI embedding request failed: {error}") from error

        if len(response.data) != len(batch):
            raise EmbeddingError(
                f"Embedding count mismatch: got {len(response.data)} for {len(batch)} inputs"
            )
        vectors = [item.embedding for item in response.data]
        for vector in vectors:
            if len(vector) != self._dimensions:
                raise EmbeddingError(
                    f"Unexpected embedding dimension {len(vector)} != {self._dimensions}"
                )
        return vectors
