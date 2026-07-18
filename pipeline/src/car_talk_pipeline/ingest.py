"""Scraping ingestion: fetch approved articles over HTTP and write canonical documents.

Combines the extraction-to-document processing, filesystem storage (raw HTML, canonical
JSON, JSONL run manifest), the thin Scrapy spider (Scrapy over HTTP, no browser), and the
``car-talk-scrape`` CLI. Extraction itself lives in ``adapter.py``.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import scrapy
from scrapy.crawler import CrawlerProcess
from scrapy.http import Request, Response

from car_talk_pipeline import PIPELINE_VERSION
from car_talk_pipeline.adapter import ExtractionError, extract_document, normalized_content
from car_talk_pipeline.hashing import sha256_bytes, sha256_text
from car_talk_pipeline.models import (
    CanonicalDocument,
    RunRecord,
    SourceEntry,
    find_source,
    load_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "sources.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / ".tmp"


# --- Processing: response -> (document, run record) ---------------------------------


def classify_status(previous_hash: str | None, current_hash: str) -> str:
    """Idempotency status of a run relative to the previous stored hash."""

    if previous_hash is None:
        return "created"
    if previous_hash == current_hash:
        return "unchanged"
    return "updated"


def process_article(
    *,
    html_bytes: bytes,
    source: SourceEntry,
    pipeline_version: str,
    previous_hash: str | None,
    timestamp: str,
) -> tuple[CanonicalDocument, RunRecord]:
    """Extract a document and build its run record.

    Raises:
        ExtractionError: Propagated from the adapter when acceptance rules fail. The
            caller records a failed ``RunRecord`` in that case.
    """

    html_text = html_bytes.decode("utf-8", errors="replace")
    document = extract_document(html_text, source)

    normalized = normalized_content(document)
    normalized_hash = sha256_text(normalized)
    run_record = RunRecord(
        document_id=source.document_id,
        url=source.url,
        status=classify_status(previous_hash, normalized_hash),
        pipeline_version=pipeline_version,
        raw_html_sha256=sha256_bytes(html_bytes),
        normalized_content_sha256=normalized_hash,
        content_char_count=len(normalized),
        section_count=len(document.sections),
        timestamp=timestamp,
    )
    return document, run_record


# --- Storage ------------------------------------------------------------------------


class IngestionStorage:
    """Resolves and writes ingestion outputs under a base directory (default ``.tmp``).

    Nothing here is committed to git: raw HTML and full processed documents are
    debug/build artifacts (spec 5.7, 27B). Canonical JSON is the rebuildable source of
    truth; Qdrant is only an index.
    """

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
        # duplicating. ``ensure_ascii=False`` keeps Hebrew readable.
        payload = json.loads(document.model_dump_json())
        self.processed_path(document.document_id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def read_processed_normalized_hash(self, document_id: str) -> str | None:
        """Return the normalized hash of the most recent run for a document, if any."""

        if not self.run_manifest_path.is_file():
            return None
        last_hash: str | None = None
        with self.run_manifest_path.open(encoding="utf-8") as manifest_file:
            for raw_line in manifest_file:
                line = raw_line.strip()
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


# --- Spider -------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _failed_record(source: SourceEntry, pipeline_version: str, error: str) -> RunRecord:
    return RunRecord(
        document_id=source.document_id,
        url=source.url,
        status="failed",
        pipeline_version=pipeline_version,
        timestamp=_now_iso(),
        error=error,
    )


class AutoCoIlSpider(scrapy.Spider):
    """Fetches approved Auto.co.il articles and writes canonical documents."""

    name = "auto_co_il"

    # Scrapy declares custom_settings as an instance variable, so ClassVar is rejected by
    # mypy; the dict is read-only config, never mutated.
    custom_settings = {  # noqa: RUF012
        "ROBOTSTXT_OBEY": True,
        "DOWNLOAD_DELAY": 1.0,
        "AUTOTHROTTLE_ENABLED": True,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 2,
        "DOWNLOAD_TIMEOUT": 30,
        "RETRY_TIMES": 2,
        "USER_AGENT": "CarTalkPOC/0.1 (+https://github.com/llm-eng-agent/Car-Talk)",
        "LOG_LEVEL": "INFO",
    }

    def __init__(
        self,
        sources: list[SourceEntry],
        storage: IngestionStorage,
        pipeline_version: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._sources = sources
        self._storage = storage
        self._pipeline_version = pipeline_version
        self._storage.ensure_dirs()

    async def start(self) -> AsyncIterator[Request]:
        # Scrapy 2.13+ replaced the sync ``start_requests`` with async ``start``.
        for source in self._sources:
            yield Request(
                url=source.url,
                callback=self.parse_article,
                errback=self.handle_error,
                cb_kwargs={"source": source},
                dont_filter=True,
            )

    def parse_article(self, response: Response, source: SourceEntry) -> None:
        previous_hash = self._storage.read_processed_normalized_hash(source.document_id)
        self._storage.write_raw_html(source.document_id, response.body)

        try:
            document, run_record = process_article(
                html_bytes=response.body,
                source=source,
                pipeline_version=self._pipeline_version,
                previous_hash=previous_hash,
                timestamp=_now_iso(),
            )
        except ExtractionError as error:
            self.logger.error("Extraction failed for %s: %s", source.document_id, error)
            self._storage.append_run_record(
                _failed_record(source, self._pipeline_version, f"extraction_error: {error}")
            )
            return

        self._storage.write_processed(document)
        self._storage.append_run_record(run_record)
        self.logger.info(
            "Processed %s: status=%s sections=%d chars=%d",
            source.document_id,
            run_record.status,
            run_record.section_count,
            run_record.content_char_count,
        )

    def handle_error(self, failure: Any) -> None:
        source: SourceEntry = failure.request.cb_kwargs["source"]
        self.logger.error("Request failed for %s: %s", source.document_id, failure.value)
        self._storage.append_run_record(
            _failed_record(source, self._pipeline_version, f"request_error: {failure.value}")
        )


# --- CLI ----------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape approved Auto.co.il review articles.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--document-id", help="Scrape a single source by document_id.")
    selection.add_argument("--all", action="store_true", help="Scrape all enabled sources.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args(argv)


def _select_sources(args: argparse.Namespace) -> list[SourceEntry]:
    manifest = load_manifest(args.manifest)
    if args.all:
        return manifest.enabled_sources()
    return [find_source(manifest, args.document_id)]


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    sources = _select_sources(args)
    storage = IngestionStorage(args.output_dir)

    process = CrawlerProcess(settings={"TELNETCONSOLE_ENABLED": False})
    process.crawl(
        AutoCoIlSpider,
        sources=sources,
        storage=storage,
        pipeline_version=PIPELINE_VERSION,
    )
    process.start()


if __name__ == "__main__":
    main()
