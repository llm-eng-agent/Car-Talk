"""Dense embeddings: provider interface, OpenAI implementation, cache, and CLI.

Chunks processed documents and embeds each chunk's enriched text via OpenAI
(``text-embedding-3-small``, 1536-d, cosine). Vectors are cached on disk so re-running
does not re-embed. Qdrant indexing is a separate later step.

The ``EmbeddingProvider`` interface isolates provider-specific code (spec section 10.5);
the POC has a single implementation, so interface and implementation live together.

Usage:
    car-talk-embed --document-id mg_s6_review
    car-talk-embed --all
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from car_talk_pipeline.chunking import (
    Chunk,
    TiktokenCounter,
    TokenCounter,
    chunk_document,
    embedding_text,
)
from car_talk_pipeline.config import load_settings
from car_talk_pipeline.hashing import sha256_text
from car_talk_pipeline.models import (
    CanonicalDocument,
    SourceEntry,
    find_source,
    load_manifest,
)

if TYPE_CHECKING:
    from openai import OpenAI

logger = logging.getLogger(__name__)

EMBEDDING_TIMEOUT_SECONDS = 10.0
MAX_RETRIES = 2
DEFAULT_BATCH_SIZE = 100

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "sources.json"
DEFAULT_TMP = REPO_ROOT / ".tmp"


# --- Provider interface -------------------------------------------------------------


class EmbeddingError(Exception):
    """Raised when embedding fails or returns an invalid response."""


class EmbeddingProvider(Protocol):
    @property
    def dimensions(self) -> int: ...

    @property
    def model_version(self) -> str: ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, query: str) -> list[float]: ...


class OpenAIEmbeddingProvider:
    """Embeds text via the OpenAI embeddings API.

    Retries transient errors with the SDK's built-in exponential backoff. Validates every
    returned vector's dimension before use (spec: validate external responses).
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
            vectors.extend(self._embed_batch(texts[start : start + self._batch_size]))
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


# --- Cache --------------------------------------------------------------------------


class EmbeddingCache:
    """Per-document JSON cache mapping ``model:content_hash`` to a vector.

    Keyed by the embedding text's content hash plus the model version, so re-running does
    not re-embed and a model change never reuses stale vectors (spec 23.5). Not committed.
    """

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir

    def _path(self, document_id: str) -> Path:
        return self.base_dir / f"{document_id}.json"

    @staticmethod
    def key(embedding_text_value: str, model_version: str) -> str:
        return f"{model_version}:{sha256_text(embedding_text_value)}"

    def load(self, document_id: str) -> dict[str, list[float]]:
        import json

        path = self._path(document_id)
        if not path.is_file():
            return {}
        loaded: dict[str, list[float]] = json.loads(path.read_text(encoding="utf-8"))
        return loaded

    def save(self, document_id: str, cache: dict[str, list[float]]) -> None:
        import json

        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._path(document_id).write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


# --- Chunk + embed orchestration ----------------------------------------------------


def embed_chunks(
    chunks: list[Chunk],
    provider: EmbeddingProvider,
    cache: dict[str, list[float]],
) -> tuple[list[list[float]], int]:
    """Return vectors aligned to ``chunks``, embedding only cache misses.

    Mutates ``cache`` in place. Returns the vectors and the number of cache misses that
    were actually sent to the provider.
    """

    keys = [EmbeddingCache.key(embedding_text(chunk), provider.model_version) for chunk in chunks]
    miss_indexes = [index for index, key in enumerate(keys) if key not in cache]
    if miss_indexes:
        miss_texts = [embedding_text(chunks[index]) for index in miss_indexes]
        new_vectors = provider.embed_documents(miss_texts)
        for index, vector in zip(miss_indexes, new_vectors, strict=True):
            cache[keys[index]] = vector
    return [cache[key] for key in keys], len(miss_indexes)


def _load_document(processed_dir: Path, document_id: str) -> CanonicalDocument:
    path = processed_dir / f"{document_id}.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"Processed document not found: {path}. Run `car-talk-scrape` first."
        )
    return CanonicalDocument.model_validate_json(path.read_text(encoding="utf-8"))


def _write_chunks(chunks_dir: Path, document_id: str, chunks: list[Chunk]) -> None:
    chunks_dir.mkdir(parents=True, exist_ok=True)
    lines = [chunk.model_dump_json() for chunk in chunks]
    (chunks_dir / f"{document_id}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


def embed_document(
    source: SourceEntry,
    processed_dir: Path,
    chunks_dir: Path,
    provider: EmbeddingProvider,
    counter: TokenCounter,
    embedding_cache: EmbeddingCache,
) -> tuple[int, int]:
    """Chunk, embed (with cache), and persist one document. Returns (chunks, embedded)."""

    document = _load_document(processed_dir, source.document_id)
    chunks = chunk_document(document, source, counter)
    cache = embedding_cache.load(source.document_id)
    _, embedded = embed_chunks(chunks, provider, cache)
    embedding_cache.save(source.document_id, cache)
    _write_chunks(chunks_dir, source.document_id, chunks)
    return len(chunks), embedded


# --- CLI ----------------------------------------------------------------------------


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Chunk and embed processed documents.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--document-id")
    selection.add_argument("--all", action="store_true")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tmp-dir", type=Path, default=DEFAULT_TMP)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = _parse_args(argv)
    manifest = load_manifest(args.manifest)
    sources = manifest.enabled_sources() if args.all else [find_source(manifest, args.document_id)]

    settings = load_settings()
    provider = OpenAIEmbeddingProvider(
        api_key=settings.openai_api_key,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )
    counter = TiktokenCounter(settings.embedding_model)
    embedding_cache = EmbeddingCache(args.tmp_dir / "embeddings")
    processed_dir = args.tmp_dir / "processed"
    chunks_dir = args.tmp_dir / "chunks"

    total_chunks = 0
    total_embedded = 0
    for source in sources:
        chunk_count, embedded = embed_document(
            source, processed_dir, chunks_dir, provider, counter, embedding_cache
        )
        total_chunks += chunk_count
        total_embedded += embedded
        logger.info(
            "%s: %d chunks (%d embedded, %d cached)",
            source.document_id,
            chunk_count,
            embedded,
            chunk_count - embedded,
        )
    logger.info(
        "Done: %d chunks, %d embedded, %d cached",
        total_chunks,
        total_embedded,
        total_chunks - total_embedded,
    )


if __name__ == "__main__":
    main()
