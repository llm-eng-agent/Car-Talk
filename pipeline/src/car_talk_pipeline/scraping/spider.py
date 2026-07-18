"""Thin Scrapy spider for Auto.co.il review articles.

The spider only fetches over normal HTTP and delegates all extraction and hashing to
``processing.process_article`` (spec: Scrapy over HTTP, no browser rendering). It writes
canonical documents, raw HTML (debug), and a JSONL run manifest via ``IngestionStorage``.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import scrapy
from scrapy.http import Request, Response

from car_talk_pipeline.scraping.auto_co_il_adapter import ExtractionError
from car_talk_pipeline.scraping.models import RunRecord, SourceEntry
from car_talk_pipeline.scraping.processing import process_article
from car_talk_pipeline.scraping.storage import IngestionStorage


class AutoCoIlSpider(scrapy.Spider):
    """Fetches approved Auto.co.il articles and writes canonical documents."""

    name = "auto_co_il"

    custom_settings = {
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

    def start_requests(self) -> Iterator[Request]:
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
        request = failure.request
        source: SourceEntry = request.cb_kwargs["source"]
        self.logger.error("Request failed for %s: %s", source.document_id, failure.value)
        self._storage.append_run_record(
            _failed_record(source, self._pipeline_version, f"request_error: {failure.value}")
        )


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
