"""Tests for Qdrant indexing (offline: a fake client records calls, no live cluster)."""

from __future__ import annotations

from typing import Any, cast

import pytest
from qdrant_client import models

from car_talk_pipeline.chunking import chunk_document, embedding_text
from car_talk_pipeline.embedding import EmbeddingCache
from car_talk_pipeline.models import (
    ArticleType,
    CanonicalDocument,
    CoverageScope,
    ProsCons,
    QAPair,
    Section,
    SourceEntry,
    Vehicle,
)
from car_talk_pipeline.qdrant_index import (
    QdrantIndexer,
    QdrantIndexError,
    index_document_from_disk,
    point_id,
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


def _document(
    sections: list[Section],
    qa_pairs: list[QAPair] | None = None,
    pros_cons: ProsCons | None = None,
) -> CanonicalDocument:
    return CanonicalDocument(
        document_id="doc1",
        vehicle_id="veh1",
        url="https://www.auto.co.il/articles/test-drives/road-tests/x/",
        title="Test Article",
        article_type=ArticleType.ROAD_TEST,
        coverage_scope=CoverageScope.FULL_REVIEW,
        vehicle=Vehicle(make="Testum", model="X", model_year=2026),
        sections=sections,
        qa_pairs=qa_pairs or [],
        pros_cons=pros_cons,
    )


class _FakeQdrantClient:
    """Records every call the indexer makes; no network."""

    def __init__(self, exists: bool = False) -> None:
        self._exists = exists
        self.created: list[dict[str, Any]] = []
        self.deleted_collections: list[str] = []
        self.payload_indexes: list[tuple[str, Any]] = []
        self.upserts: list[list[Any]] = []
        self.deletes: list[Any] = []

    def collection_exists(self, collection_name: str) -> bool:
        return self._exists

    def delete_collection(self, collection_name: str) -> None:
        self.deleted_collections.append(collection_name)
        self._exists = False

    def create_collection(
        self,
        collection_name: str,
        vectors_config: Any,
        sparse_vectors_config: Any,
    ) -> None:
        self.created.append(
            {
                "name": collection_name,
                "vectors_config": vectors_config,
                "sparse_vectors_config": sparse_vectors_config,
            }
        )
        self._exists = True

    def create_payload_index(
        self, collection_name: str, field_name: str, field_schema: Any
    ) -> None:
        self.payload_indexes.append((field_name, field_schema))

    def upsert(self, collection_name: str, points: list[Any]) -> None:
        self.upserts.append(points)

    def delete(self, collection_name: str, points_selector: Any) -> None:
        self.deletes.append(points_selector)


def _indexer(client: _FakeQdrantClient) -> QdrantIndexer:
    return QdrantIndexer(collection="car_review_chunks_v1", client=cast(Any, client))


def test_ensure_collection_creates_named_vectors_and_indexes_when_absent() -> None:
    client = _FakeQdrantClient(exists=False)
    _indexer(client).ensure_collection()

    assert len(client.created) == 1
    created = client.created[0]
    assert created["name"] == "car_review_chunks_v1"
    dense = created["vectors_config"]["dense"]
    assert dense.size == 1536
    assert dense.distance == models.Distance.COSINE
    assert "bm25" in created["sparse_vectors_config"]
    # Six keyword indexes + one integer index (model_year).
    indexed_fields = {field for field, _ in client.payload_indexes}
    assert indexed_fields == {
        "vehicle_id",
        "document_id",
        "vehicle_make",
        "vehicle_model",
        "article_type",
        "coverage_scope",
        "model_year",
    }


def test_ensure_collection_is_idempotent_when_present() -> None:
    client = _FakeQdrantClient(exists=True)
    _indexer(client).ensure_collection()
    assert client.created == []
    assert client.payload_indexes == []


def test_ensure_collection_recreate_drops_first() -> None:
    client = _FakeQdrantClient(exists=True)
    _indexer(client).ensure_collection(recreate=True)
    assert client.deleted_collections == ["car_review_chunks_v1"]
    assert len(client.created) == 1


def test_point_id_is_deterministic_uuid5() -> None:
    assert point_id("doc1::b0::c0") == point_id("doc1::b0::c0")
    assert point_id("doc1::b0::c0") != point_id("doc1::b0::c1")


def test_index_document_builds_one_point_per_chunk_with_payload() -> None:
    doc = _document(
        [Section(heading="A", paragraphs=["short text here"])],
        qa_pairs=[QAPair(question="שאלה", answer="תשובה")],
    )
    source = _source()
    chunks = chunk_document(doc, source, word_count)
    vectors = [[0.1] * 1536 for _ in chunks]

    client = _FakeQdrantClient(exists=True)
    written = _indexer(client).index_document(source, chunks, vectors)

    assert written == len(chunks)
    points = client.upserts[0]
    assert len(points) == len(chunks)
    # Ids are the deterministic UUIDv5 of each chunk_id.
    assert [p.id for p in points] == [point_id(c.chunk_id) for c in chunks]
    # Named vectors present; sparse is a server-side inference Document.
    first = points[0]
    assert first.vector["dense"] == [0.1] * 1536
    assert isinstance(first.vector["bm25"], models.Document)
    assert first.vector["bm25"].model == "qdrant/bm25"
    # Payload carries indexed filter fields + full text.
    payload = first.payload
    assert payload["article_type"] == "road_test"
    assert payload["coverage_scope"] == "full_review"
    assert payload["content"]
    # Q&A chunk preserves publisher_faq provenance (ADR 0001).
    qa_payload = next(p.payload for p in points if p.payload["content_type"] == "qa")
    assert qa_payload["provenance"] == "publisher_faq"


def test_index_document_deletes_before_upsert() -> None:
    doc = _document([Section(heading="A", paragraphs=["short text here"])])
    source = _source()
    chunks = chunk_document(doc, source, word_count)
    client = _FakeQdrantClient(exists=True)
    _indexer(client).index_document(source, chunks, [[0.1] * 1536 for _ in chunks])
    # A document_id filter delete is issued (replace-by-document).
    assert len(client.deletes) == 1
    condition = client.deletes[0].must[0]
    assert condition.key == "document_id"
    assert condition.match.value == "doc1"


def test_index_document_rejects_count_mismatch() -> None:
    doc = _document([Section(heading="A", paragraphs=["short text here"])])
    source = _source()
    chunks = chunk_document(doc, source, word_count)
    with pytest.raises(QdrantIndexError, match="mismatch"):
        _indexer(_FakeQdrantClient()).index_document(source, chunks, [])


def test_index_document_from_disk_aligns_cached_vectors(tmp_path: Any) -> None:
    doc = _document([Section(heading="A", paragraphs=["short text here"])])
    source = _source()
    chunks = chunk_document(doc, source, word_count)

    # Write chunks JSONL and a matching embedding cache, as car-talk-embed would.
    chunks_dir = tmp_path / "chunks"
    chunks_dir.mkdir()
    (chunks_dir / "doc1.jsonl").write_text(
        "\n".join(c.model_dump_json() for c in chunks) + "\n", encoding="utf-8"
    )
    cache = EmbeddingCache(tmp_path / "embeddings")
    model_version = "text-embedding-3-small"
    stored = {EmbeddingCache.key(embedding_text(c), model_version): [0.2] * 1536 for c in chunks}
    cache.save("doc1", stored)

    client = _FakeQdrantClient(exists=True)
    written = index_document_from_disk(source, chunks_dir, cache, _indexer(client), model_version)
    assert written == len(chunks)
    assert client.upserts[0][0].vector["dense"] == [0.2] * 1536


def test_index_document_from_disk_missing_vector_raises(tmp_path: Any) -> None:
    doc = _document([Section(heading="A", paragraphs=["short text here"])])
    source = _source()
    chunks = chunk_document(doc, source, word_count)
    chunks_dir = tmp_path / "chunks"
    chunks_dir.mkdir()
    (chunks_dir / "doc1.jsonl").write_text(
        "\n".join(c.model_dump_json() for c in chunks) + "\n", encoding="utf-8"
    )
    cache = EmbeddingCache(tmp_path / "embeddings")  # empty cache
    with pytest.raises(QdrantIndexError, match="No cached vector"):
        index_document_from_disk(
            source,
            chunks_dir,
            cache,
            _indexer(client=_FakeQdrantClient()),
            "text-embedding-3-small",
        )
