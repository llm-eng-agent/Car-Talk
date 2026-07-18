"""Turn a fetched HTML response into a canonical document plus a run record.

Kept separate from Scrapy so the logic is deterministic and unit-testable: the only
non-deterministic input (the timestamp) is injected by the caller.
"""

from __future__ import annotations

from car_talk_pipeline.scraping.auto_co_il_adapter import extract_document, normalized_content
from car_talk_pipeline.scraping.hashing import sha256_bytes, sha256_text
from car_talk_pipeline.scraping.models import CanonicalDocument, RunRecord, SourceEntry


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
            caller is responsible for recording a failed ``RunRecord`` in that case.
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
