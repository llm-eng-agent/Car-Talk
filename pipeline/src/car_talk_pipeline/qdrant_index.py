"""Index chunks + dense vectors into a hybrid Qdrant collection (spec sections 8, 9.5-9.6).

The final offline stage: ``scrape -> process -> chunk -> embed -> index Qdrant``. Reads the
chunks and cached dense vectors produced by ``car-talk-embed`` and upserts them into one
shared collection with a named dense vector (``dense``, 1536-d, cosine) and a named sparse
vector (``bm25``, Qdrant server-side ``qdrant/bm25`` inference). Fusion is RRF at query time.

Qdrant is an index, not the source of truth: the whole collection is rebuildable from the
processed files (spec 8.6). Point ids are a deterministic UUIDv5 of ``chunk_id`` so re-runs
upsert in place, and a document is replaced by deleting its points by ``document_id`` payload
filter before re-inserting (spec 20.6). Sparse vectors are generated server-side so Python
indexing and the future TypeScript query side produce identical BM25 representations.

Usage:
    car-talk-index --document-id mg_s6_review
    car-talk-index --all
    car-talk-index --all --recreate
"""

from __future__ import annotations

import argparse
import logging
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from qdrant_client import QdrantClient, models

from car_talk_pipeline.chunking import Chunk, embedding_text
from car_talk_pipeline.config import load_settings, require_qdrant
from car_talk_pipeline.embedding import EmbeddingCache
from car_talk_pipeline.models import SourceEntry, find_source, load_manifest

if TYPE_CHECKING:
    from car_talk_pipeline.config import Settings

logger = logging.getLogger(__name__)

QDRANT_TIMEOUT_SECONDS = 10

DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "bm25"
BM25_MODEL = "qdrant/bm25"
DENSE_SIZE = 1536

# Payload fields indexed for filtering (spec 8: vehicle isolation via payload). Everything
# else in the payload is stored for grounding/citation display but not indexed.
KEYWORD_PAYLOAD_FIELDS = (
    "vehicle_id",
    "document_id",
    "vehicle_make",
    "vehicle_model",
    "article_type",
    "coverage_scope",
)
INTEGER_PAYLOAD_FIELD = "model_year"

# Stable namespace for deriving point ids from chunk ids (UUIDv5). Constant so ids never
# change between runs, which keeps upserts idempotent.
POINT_ID_NAMESPACE = uuid.UUID("6b1f3c2e-9d4a-5e6f-8a7b-0c1d2e3f4a5b")

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "sources.json"
DEFAULT_TMP = REPO_ROOT / ".tmp"


class QdrantIndexError(Exception):
    """Raised when indexing fails (missing vectors, client errors)."""


def point_id(chunk_id: str) -> str:
    """Deterministic UUIDv5 point id for a chunk (stable across rebuilds)."""

    return str(uuid.uuid5(POINT_ID_NAMESPACE, chunk_id))


def _payload(chunk: Chunk, source: SourceEntry) -> dict[str, object]:
    """Build the point payload: indexed filter fields + full text for grounding."""

    return {
        "chunk_id": chunk.chunk_id,
        "document_id": chunk.document_id,
        "vehicle_id": chunk.vehicle_id,
        "vehicle_make": chunk.vehicle_make,
        "vehicle_model": chunk.vehicle_model,
        "model_year": chunk.model_year,
        "canonical_vehicle_name": chunk.canonical_vehicle_name,
        "article_title": chunk.article_title,
        "section_heading": chunk.section_heading,
        "chunk_index": chunk.chunk_index,
        "content": chunk.content,
        "source_url": chunk.source_url,
        "token_count": chunk.token_count,
        "content_type": chunk.content_type.value,
        "provenance": chunk.provenance,
        # article_type / coverage_scope live on the source manifest entry, not the chunk.
        "article_type": source.article_type.value,
        "coverage_scope": source.coverage_scope.value,
    }


class QdrantIndexer:
    """Creates the hybrid collection and upserts chunk points.

    The ``client`` is injectable so offline tests can pass a fake (mirrors
    ``OpenAIEmbeddingProvider``). The real client uses Qdrant Cloud server-side inference so
    ``qdrant/bm25`` sparse vectors match the online query side.
    """

    def __init__(
        self,
        collection: str,
        url: str | None = None,
        api_key: str | None = None,
        client: QdrantClient | None = None,
    ) -> None:
        self.collection = collection
        if client is not None:
            self._client = client
        else:
            self._client = QdrantClient(
                url=url,
                api_key=api_key,
                timeout=QDRANT_TIMEOUT_SECONDS,
                cloud_inference=True,
            )

    def ensure_collection(self, *, recreate: bool = False) -> None:
        """Create the collection and payload indexes if absent (idempotent).

        With ``recreate`` the collection is dropped first for a clean full rebuild.
        """

        if recreate and self._client.collection_exists(self.collection):
            self._client.delete_collection(self.collection)

        if self._client.collection_exists(self.collection):
            return

        self._client.create_collection(
            collection_name=self.collection,
            vectors_config={
                DENSE_VECTOR_NAME: models.VectorParams(
                    size=DENSE_SIZE, distance=models.Distance.COSINE
                )
            },
            sparse_vectors_config={
                # IDF is required for BM25 scoring to be applied server-side.
                SPARSE_VECTOR_NAME: models.SparseVectorParams(modifier=models.Modifier.IDF)
            },
        )
        for field in KEYWORD_PAYLOAD_FIELDS:
            self._client.create_payload_index(
                self.collection, field_name=field, field_schema=models.PayloadSchemaType.KEYWORD
            )
        self._client.create_payload_index(
            self.collection,
            field_name=INTEGER_PAYLOAD_FIELD,
            field_schema=models.PayloadSchemaType.INTEGER,
        )

    def delete_document(self, document_id: str) -> None:
        """Delete all points for a document by payload filter (replace-by-document, 20.6)."""

        self._client.delete(
            collection_name=self.collection,
            points_selector=models.Filter(
                must=[
                    models.FieldCondition(
                        key="document_id", match=models.MatchValue(value=document_id)
                    )
                ]
            ),
        )

    def index_document(
        self, source: SourceEntry, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int:
        """Upsert one document's points; returns the number of points written.

        Deletes the document's existing points first so a re-index never leaves stale chunks.
        """

        if len(chunks) != len(vectors):
            raise QdrantIndexError(
                f"chunk/vector count mismatch for {source.document_id}: "
                f"{len(chunks)} chunks, {len(vectors)} vectors"
            )
        points = [
            models.PointStruct(
                id=point_id(chunk.chunk_id),
                vector={
                    DENSE_VECTOR_NAME: vector,
                    SPARSE_VECTOR_NAME: models.Document(
                        text=embedding_text(chunk), model=BM25_MODEL
                    ),
                },
                payload=_payload(chunk, source),
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        self.delete_document(source.document_id)
        self._client.upsert(collection_name=self.collection, points=points)
        return len(points)


def _read_chunks(chunks_dir: Path, document_id: str) -> list[Chunk]:
    path = chunks_dir / f"{document_id}.jsonl"
    if not path.is_file():
        raise QdrantIndexError(f"Chunks not found: {path}. Run `car-talk-embed` first.")
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [Chunk.model_validate_json(line) for line in lines]


def _align_vectors(
    chunks: list[Chunk], cache: dict[str, list[float]], model_version: str
) -> list[list[float]]:
    """Look up each chunk's cached dense vector by embedding-text hash key."""

    vectors: list[list[float]] = []
    for chunk in chunks:
        key = EmbeddingCache.key(embedding_text(chunk), model_version)
        vector = cache.get(key)
        if vector is None:
            raise QdrantIndexError(
                f"No cached vector for chunk {chunk.chunk_id}. Re-run `car-talk-embed`."
            )
        vectors.append(vector)
    return vectors


def index_document_from_disk(
    source: SourceEntry,
    chunks_dir: Path,
    embedding_cache: EmbeddingCache,
    indexer: QdrantIndexer,
    model_version: str,
) -> int:
    """Read a document's chunks + cached vectors from disk and index them. Returns points."""

    chunks = _read_chunks(chunks_dir, source.document_id)
    cache = embedding_cache.load(source.document_id)
    vectors = _align_vectors(chunks, cache, model_version)
    return indexer.index_document(source, chunks, vectors)


# --- CLI ----------------------------------------------------------------------------


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Index chunks + vectors into Qdrant.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--document-id")
    selection.add_argument("--all", action="store_true")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tmp-dir", type=Path, default=DEFAULT_TMP)
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop and recreate the collection before indexing (clean full rebuild).",
    )
    return parser.parse_args(argv)


def _build_indexer(settings: Settings) -> QdrantIndexer:
    url, api_key, collection = require_qdrant(settings)
    return QdrantIndexer(collection=collection, url=url, api_key=api_key)


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = _parse_args(argv)
    manifest = load_manifest(args.manifest)
    sources = manifest.enabled_sources() if args.all else [find_source(manifest, args.document_id)]

    settings = load_settings()
    indexer = _build_indexer(settings)
    indexer.ensure_collection(recreate=args.recreate)

    embedding_cache = EmbeddingCache(args.tmp_dir / "embeddings")
    chunks_dir = args.tmp_dir / "chunks"

    total_points = 0
    for source in sources:
        points = index_document_from_disk(
            source, chunks_dir, embedding_cache, indexer, settings.embedding_model
        )
        total_points += points
        logger.info("%s: %d points indexed", source.document_id, points)
    logger.info("Done: %d points across %d documents", total_points, len(sources))


if __name__ == "__main__":
    main()
