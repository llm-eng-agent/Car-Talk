"""Filesystem layout and writers for ingestion outputs.

Nothing here is committed to git: raw HTML and full processed documents are debug/build
artifacts (spec section 5.7, 27B). Canonical processed JSON is the rebuildable source of
truth for downstream stages; Qdrant is only an index.
"""

from __future__ import annotations

import json
from pathlib import Path

from car_talk_pipeline.scraping.models import CanonicalDocument, RunRecord


class IngestionStorage:
    """Resolves output paths under a base directory (default ``.tmp``)."""

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.raw_dir = base_dir / "raw"
        self.processed_dir = base_dir / "processed"
        self.run_manifest_path = base_dir / "run_manifest.jsonl"

    def ensure_dirs(self) -> None:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.processed_dir.mkdir(parents=True, exist_ok=True)

    def raw_path(self, document_id: str) -> Path:
        return self.raw_dir / f"{document_id}.html"

    def processed_path(self, document_id: str) -> Path:
        return self.processed_dir / f"{document_id}.json"

    def write_raw_html(self, document_id: str, html_bytes: bytes) -> None:
        self.raw_path(document_id).write_bytes(html_bytes)

    def write_processed(self, document: CanonicalDocument) -> None:
        # Deterministic path per document_id: re-running overwrites rather than
        # duplicating (spec Phase 2 Definition of Done: "Re-running does not create
        # duplicates"). ``ensure_ascii=False`` keeps Hebrew readable.
        path = self.processed_path(document.document_id)
        payload = json.loads(document.model_dump_json())
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def read_processed_normalized_hash(self, document_id: str) -> str | None:
        """Return the normalized hash of a previously stored run, if any.

        Reads the last matching line of the run manifest so idempotency can classify a
        re-run as created / unchanged / updated.
        """

        if not self.run_manifest_path.is_file():
            return None
        last_hash: str | None = None
        with self.run_manifest_path.open(encoding="utf-8") as manifest_file:
            for line in manifest_file:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                if record.get("document_id") == document_id:
                    last_hash = record.get("normalized_content_sha256")
        return last_hash

    def append_run_record(self, record: RunRecord) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        with self.run_manifest_path.open("a", encoding="utf-8") as manifest_file:
            manifest_file.write(record.model_dump_json() + "\n")
