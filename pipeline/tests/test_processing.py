"""Tests for the deterministic processing layer (extraction + hashing + run record)."""

from __future__ import annotations

from pathlib import Path

import pytest

from car_talk_pipeline.scraping.models import ArticleType, CoverageScope, SourceEntry
from car_talk_pipeline.scraping.processing import classify_status, process_article

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_article.html"
TIMESTAMP = "2026-07-18T00:00:00+00:00"


def _source() -> SourceEntry:
    return SourceEntry(
        document_id="synthetic_zx_review",
        vehicle_id="synthetic_zx",
        canonical_name="Synthetic ZX",
        make="Synthetic",
        model="ZX",
        model_year=None,
        article_type=ArticleType.ROAD_TEST,
        coverage_scope=CoverageScope.FULL_REVIEW,
        url="https://www.auto.co.il/articles/test-drives/road-tests/synthetic-zx/",
    )


@pytest.fixture
def html_bytes() -> bytes:
    return FIXTURE.read_bytes()


@pytest.mark.parametrize(
    ("previous", "current", "expected"),
    [
        (None, "abc", "created"),
        ("abc", "abc", "unchanged"),
        ("abc", "def", "updated"),
    ],
)
def test_classify_status(previous: str | None, current: str, expected: str) -> None:
    assert classify_status(previous, current) == expected


def test_process_article_first_run_is_created(html_bytes: bytes) -> None:
    document, record = process_article(
        html_bytes=html_bytes,
        source=_source(),
        pipeline_version="0.1.0",
        previous_hash=None,
        timestamp=TIMESTAMP,
    )
    assert document.document_id == "synthetic_zx_review"
    assert record.status == "created"
    assert record.section_count == len(document.sections)
    assert record.content_char_count is not None and record.content_char_count >= 1000
    assert record.raw_html_sha256 is not None
    assert record.normalized_content_sha256 is not None


def test_process_article_is_deterministic_and_detects_unchanged(html_bytes: bytes) -> None:
    _, first = process_article(
        html_bytes=html_bytes,
        source=_source(),
        pipeline_version="0.1.0",
        previous_hash=None,
        timestamp=TIMESTAMP,
    )
    _, second = process_article(
        html_bytes=html_bytes,
        source=_source(),
        pipeline_version="0.1.0",
        previous_hash=first.normalized_content_sha256,
        timestamp=TIMESTAMP,
    )
    assert first.normalized_content_sha256 == second.normalized_content_sha256
    assert second.status == "unchanged"
