"""CLI: chunk processed documents and embed the chunks (with caching).

Reads canonical documents from ``.tmp/processed/`` (produced by ``car-talk-scrape``),
chunks them, embeds each chunk's enriched text via OpenAI, caches vectors on disk, and
writes chunk payloads to ``.tmp/chunks/``. Qdrant indexing is a separate later step.

Usage:
    car-talk-embed --document-id mg_s6_review
    car-talk-embed --all
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from car_talk_pipeline.chunking.chunker import chunk_document, embedding_text
from car_talk_pipeline.chunking.models import Chunk
from car_talk_pipeline.chunking.tokenizer import TiktokenCounter, TokenCounter
from car_talk_pipeline.config import load_settings
from car_talk_pipeline.embedding.cache import EmbeddingCache
from car_talk_pipeline.embedding.openai_provider import OpenAIEmbeddingProvider
from car_talk_pipeline.embedding.provider import EmbeddingProvider
from car_talk_pipeline.scraping.manifest import find_source, load_manifest
from car_talk_pipeline.scraping.models import CanonicalDocument, SourceEntry

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "sources.json"
DEFAULT_TMP = REPO_ROOT / ".tmp"


def embed_chunks(
    chunks: list[Chunk],
    provider: EmbeddingProvider,
    cache: dict[str, list[float]],
) -> tuple[list[list[float]], int]:
    """Return vectors aligned to ``chunks``, embedding only cache misses.

    Mutates ``cache`` in place with any newly embedded vectors. Returns the vectors and
    the number of chunks that were actually sent to the provider (cache misses).
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
