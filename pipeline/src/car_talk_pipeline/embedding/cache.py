"""On-disk embedding cache (spec section 23.5: persist document embeddings).

Keyed by the embedding text's content hash plus the model version, so re-running does not
re-embed unchanged chunks and a model change never reuses stale vectors. Never committed
(lives under ``.tmp/``).
"""

from __future__ import annotations

import json
from pathlib import Path

from car_talk_pipeline.scraping.hashing import sha256_text


class EmbeddingCache:
    """Per-document JSON cache mapping ``model:content_hash`` to a vector."""

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir

    def _path(self, document_id: str) -> Path:
        return self.base_dir / f"{document_id}.json"

    @staticmethod
    def key(embedding_text: str, model_version: str) -> str:
        return f"{model_version}:{sha256_text(embedding_text)}"

    def load(self, document_id: str) -> dict[str, list[float]]:
        path = self._path(document_id)
        if not path.is_file():
            return {}
        loaded: dict[str, list[float]] = json.loads(path.read_text(encoding="utf-8"))
        return loaded

    def save(self, document_id: str, cache: dict[str, list[float]]) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._path(document_id).write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
