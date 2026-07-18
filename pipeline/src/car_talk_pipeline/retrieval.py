"""Query-side retrieval over the hybrid Qdrant collection (spec sections 9-10).

Three retrieval modes against `car_review_chunks_v1`:
- ``dense``: cosine over the OpenAI query embedding (embedded client-side — Qdrant Cloud
  hosts only BM25 server-side, not ``text-embedding-3-small``).
- ``bm25``: Qdrant server-side ``qdrant/bm25`` sparse retrieval from the query text.
- ``hybrid``: RRF fusion of a dense prefetch (20) and a BM25 prefetch (20), equal weights
  (spec: weights not tuned on the eval set).

Reused by the evaluation runner and later by the Phase 5 retrieval orchestrator. The Qdrant
client and embedding provider are both injectable so tests run offline.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel, ConfigDict
from qdrant_client import models

from car_talk_pipeline.qdrant_index import (
    BM25_MODEL,
    DENSE_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
)

if TYPE_CHECKING:
    from qdrant_client import QdrantClient

    from car_talk_pipeline.embedding import EmbeddingProvider

DENSE_PREFETCH = 20
BM25_PREFETCH = 20
DEFAULT_TOP_K = 5


class RetrievalMode(StrEnum):
    DENSE = "dense"
    BM25 = "bm25"
    HYBRID = "hybrid"


class RetrievedChunk(BaseModel):
    """One ranked search hit (payload projection + fusion/similarity score)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    chunk_id: str
    document_id: str
    vehicle_id: str
    score: float
    section_heading: str
    content_type: str
    content: str


class RetrievalError(Exception):
    """Raised when a retrieval request fails or returns malformed data."""


class Retriever(Protocol):
    """Query interface used by the evaluation runner (satisfied by ``HybridRetriever``)."""

    collection: str

    def search(
        self,
        query_text: str,
        mode: RetrievalMode,
        top_k: int = ...,
        vehicle_ids: list[str] | None = ...,
    ) -> list[RetrievedChunk]: ...


class HybridRetriever:
    """Runs dense / BM25 / hybrid queries against the collection."""

    def __init__(
        self,
        collection: str,
        provider: EmbeddingProvider,
        client: QdrantClient,
    ) -> None:
        self.collection = collection
        self._provider = provider
        self._client = client

    def search(
        self,
        query_text: str,
        mode: RetrievalMode,
        top_k: int = DEFAULT_TOP_K,
        vehicle_ids: list[str] | None = None,
    ) -> list[RetrievedChunk]:
        """Return the top-``top_k`` chunks for ``query_text`` under ``mode``.

        ``vehicle_ids`` (when given) restricts results to those vehicles via a payload filter.
        """

        query_filter = self._vehicle_filter(vehicle_ids)
        if mode is RetrievalMode.DENSE:
            response = self._client.query_points(
                collection_name=self.collection,
                query=self._provider.embed_query(query_text),
                using=DENSE_VECTOR_NAME,
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
            )
        elif mode is RetrievalMode.BM25:
            response = self._client.query_points(
                collection_name=self.collection,
                query=models.Document(text=query_text, model=BM25_MODEL),
                using=SPARSE_VECTOR_NAME,
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
            )
        else:  # HYBRID
            response = self._client.query_points(
                collection_name=self.collection,
                prefetch=[
                    models.Prefetch(
                        query=self._provider.embed_query(query_text),
                        using=DENSE_VECTOR_NAME,
                        limit=DENSE_PREFETCH,
                    ),
                    models.Prefetch(
                        query=models.Document(text=query_text, model=BM25_MODEL),
                        using=SPARSE_VECTOR_NAME,
                        limit=BM25_PREFETCH,
                    ),
                ],
                query=models.FusionQuery(fusion=models.Fusion.RRF),
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
            )
        return [_to_chunk(point) for point in response.points]

    @staticmethod
    def _vehicle_filter(vehicle_ids: list[str] | None) -> models.Filter | None:
        if not vehicle_ids:
            return None
        return models.Filter(
            must=[models.FieldCondition(key="vehicle_id", match=models.MatchAny(any=vehicle_ids))]
        )


def _to_chunk(point: models.ScoredPoint) -> RetrievedChunk:
    payload = point.payload or {}
    try:
        return RetrievedChunk(
            chunk_id=payload["chunk_id"],
            document_id=payload["document_id"],
            vehicle_id=payload["vehicle_id"],
            score=point.score,
            section_heading=payload["section_heading"],
            content_type=payload["content_type"],
            content=payload["content"],
        )
    except KeyError as error:
        raise RetrievalError(f"Result point missing payload field {error}") from error
