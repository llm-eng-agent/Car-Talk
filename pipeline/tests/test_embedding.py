"""Tests for the embedding provider and cache-aware embedding (offline, mocked)."""

from __future__ import annotations

import types
from typing import Any, cast

import pytest

from car_talk_pipeline.chunking import chunk_document
from car_talk_pipeline.embedding import EmbeddingError, OpenAIEmbeddingProvider, embed_chunks
from car_talk_pipeline.models import (
    ArticleType,
    CanonicalDocument,
    CoverageScope,
    Section,
    SourceEntry,
    Vehicle,
)


def word_count(text: str) -> int:
    return len(text.split())


def _source() -> SourceEntry:
    return SourceEntry(
        document_id="doc1",
        vehicle_id="veh1",
        canonical_name="Test Vehicle",
        make="Testum",
        model="X",
        model_year=2026,
        article_type=ArticleType.ROAD_TEST,
        coverage_scope=CoverageScope.FULL_REVIEW,
        url="https://www.auto.co.il/articles/test-drives/road-tests/x/",
    )


def _document(sections: list[Section]) -> CanonicalDocument:
    return CanonicalDocument(
        document_id="doc1",
        vehicle_id="veh1",
        url="https://www.auto.co.il/articles/test-drives/road-tests/x/",
        title="Test Article",
        article_type=ArticleType.ROAD_TEST,
        coverage_scope=CoverageScope.FULL_REVIEW,
        vehicle=Vehicle(make="Testum", model="X", model_year=2026),
        sections=sections,
    )


class _FakeEmbeddings:
    def __init__(self, returned_dims: int, calls: list[int]) -> None:
        self._dims = returned_dims
        self._calls = calls

    def create(self, model: str, input: list[str], dimensions: int) -> object:
        self._calls.append(len(input))
        data = [types.SimpleNamespace(embedding=[0.1] * self._dims) for _ in input]
        return types.SimpleNamespace(data=data)


class _FakeOpenAIClient:
    def __init__(self, returned_dims: int = 1536) -> None:
        self.calls: list[int] = []
        self.embeddings = _FakeEmbeddings(returned_dims, self.calls)


def _provider(client: _FakeOpenAIClient, batch_size: int = 2) -> OpenAIEmbeddingProvider:
    return OpenAIEmbeddingProvider(
        api_key="test", dimensions=1536, batch_size=batch_size, client=cast(Any, client)
    )


def test_embed_documents_batches_and_preserves_order() -> None:
    client = _FakeOpenAIClient()
    provider = _provider(client, batch_size=2)
    vectors = provider.embed_documents(["a", "b", "c"])
    assert len(vectors) == 3
    assert all(len(v) == 1536 for v in vectors)
    assert client.calls == [2, 1]  # batched by 2


def test_embed_query_returns_single_vector() -> None:
    provider = _provider(_FakeOpenAIClient())
    assert len(provider.embed_query("שאלה")) == 1536


def test_wrong_dimension_raises() -> None:
    provider = _provider(_FakeOpenAIClient(returned_dims=1500))
    with pytest.raises(EmbeddingError, match="dimension"):
        provider.embed_documents(["a"])


class _CountingProvider:
    """Minimal EmbeddingProvider that records how many texts it embedded."""

    def __init__(self) -> None:
        self.embedded_texts: list[str] = []

    @property
    def dimensions(self) -> int:
        return 4

    @property
    def model_version(self) -> str:
        return "fake-model"

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.embedded_texts.extend(texts)
        return [[0.0, 0.0, 0.0, 0.0] for _ in texts]

    def embed_query(self, query: str) -> list[float]:
        return [0.0, 0.0, 0.0, 0.0]


def test_embed_chunks_uses_cache_on_second_run() -> None:
    doc = _document([Section(heading="A", paragraphs=["short text here"])])
    chunks = chunk_document(doc, _source(), word_count)
    provider = _CountingProvider()
    cache: dict[str, list[float]] = {}

    vectors, embedded = embed_chunks(chunks, provider, cache)
    assert embedded == len(chunks)
    assert len(vectors) == len(chunks)
    assert len(provider.embedded_texts) == len(chunks)

    # Second run: everything served from cache, nothing re-embedded.
    provider.embedded_texts.clear()
    _, embedded_again = embed_chunks(chunks, provider, cache)
    assert embedded_again == 0
    assert provider.embedded_texts == []
