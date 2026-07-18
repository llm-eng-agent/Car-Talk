"""Tests for the query-side retriever (offline: fake Qdrant client + fake provider)."""

from __future__ import annotations

import types
from typing import Any, cast

import pytest
from qdrant_client import models

from car_talk_pipeline.retrieval import (
    HybridRetriever,
    RetrievalError,
    RetrievalMode,
)


class _FakeProvider:
    """Minimal EmbeddingProvider that returns a fixed query vector and records calls."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    @property
    def dimensions(self) -> int:
        return 4

    @property
    def model_version(self) -> str:
        return "fake"

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in texts]

    def embed_query(self, query: str) -> list[float]:
        self.queries.append(query)
        return [0.1, 0.2, 0.3, 0.4]


def _point(chunk_id: str, vehicle_id: str, score: float) -> Any:
    return types.SimpleNamespace(
        id="uuid",
        score=score,
        payload={
            "chunk_id": chunk_id,
            "document_id": f"{vehicle_id}_review",
            "vehicle_id": vehicle_id,
            "section_heading": "h",
            "content_type": "section",
            "content": "טקסט",
        },
    )


class _FakeQdrantClient:
    def __init__(self, points: list[Any] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._points = points or [_point("mg_s6_review::b0::c0", "mg_s6", 0.9)]

    def query_points(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return types.SimpleNamespace(points=self._points)


def _retriever(client: _FakeQdrantClient, provider: _FakeProvider) -> HybridRetriever:
    return HybridRetriever(
        collection="car_review_chunks_v1", provider=provider, client=cast(Any, client)
    )


def test_dense_search_uses_query_vector() -> None:
    client, provider = _FakeQdrantClient(), _FakeProvider()
    hits = _retriever(client, provider).search("טווח", RetrievalMode.DENSE, top_k=5)
    call = client.calls[0]
    assert call["using"] == "dense"
    assert call["query"] == [0.1, 0.2, 0.3, 0.4]
    assert call["limit"] == 5
    assert provider.queries == ["טווח"]
    assert hits[0].vehicle_id == "mg_s6"


def test_bm25_search_uses_server_side_document() -> None:
    client, provider = _FakeQdrantClient(), _FakeProvider()
    _retriever(client, provider).search("178,888", RetrievalMode.BM25)
    call = client.calls[0]
    assert call["using"] == "bm25"
    assert isinstance(call["query"], models.Document)
    assert call["query"].model == "qdrant/bm25"
    assert provider.queries == []  # BM25 does not embed client-side


def test_hybrid_search_uses_rrf_fusion_of_two_prefetches() -> None:
    client, provider = _FakeQdrantClient(), _FakeProvider()
    _retriever(client, provider).search("MG S6 טווח", RetrievalMode.HYBRID)
    call = client.calls[0]
    assert isinstance(call["query"], models.FusionQuery)
    assert call["query"].fusion == models.Fusion.RRF
    usings = {p.using for p in call["prefetch"]}
    assert usings == {"dense", "bm25"}


def test_vehicle_filter_is_applied() -> None:
    client, provider = _FakeQdrantClient(), _FakeProvider()
    _retriever(client, provider).search(
        "השוואה", RetrievalMode.HYBRID, vehicle_ids=["mg_s6", "aion_ht"]
    )
    condition = client.calls[0]["query_filter"].must[0]
    assert condition.key == "vehicle_id"
    assert set(condition.match.any) == {"mg_s6", "aion_ht"}


def test_no_filter_when_vehicle_ids_absent() -> None:
    client, provider = _FakeQdrantClient(), _FakeProvider()
    _retriever(client, provider).search("שאלה", RetrievalMode.DENSE)
    assert client.calls[0]["query_filter"] is None


def test_missing_payload_field_raises() -> None:
    bad = types.SimpleNamespace(id="x", score=0.5, payload={"chunk_id": "c"})
    client, provider = _FakeQdrantClient(points=[bad]), _FakeProvider()
    with pytest.raises(RetrievalError, match="payload field"):
        _retriever(client, provider).search("q", RetrievalMode.DENSE)
