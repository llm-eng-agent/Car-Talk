"""Extraction acceptance tests — the binding contract for Auto.co.il ingestion.

Run against a synthetic fixture only (no real scraped text). These tests define what
"correct extraction" means; the selectors in the adapter may change as long as these pass
(spec: Locked Contract / source ingestion).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from car_talk_pipeline.scraping.auto_co_il_adapter import (
    INTRODUCTION_HEADING,
    ExtractionError,
    extract_document,
    normalized_content,
)
from car_talk_pipeline.scraping.models import (
    ArticleType,
    CoverageScope,
    QASource,
    SourceEntry,
)

FIXTURES = Path(__file__).parent / "fixtures"

# Sentinels embedded in every block that must NOT appear in extracted content.
# Note: the FAQ Q&A accordion and the pros/cons verdict table are intentionally INCLUDED
# now (see docs/adr/0001), so they carry no sentinel. The competitor spec-comparison
# table (vehicle-table) stays excluded and is asserted here.
EXCLUDED_SENTINELS = [
    "EXCLUDE_HEAD_TITLE",
    "EXCLUDE_NAV_HOME",
    "EXCLUDE_NAV_ARTICLES",
    "EXCLUDE_COOKIE_BANNER",
    "EXCLUDE_GALLERY_CAPTION",
    "EXCLUDE_AD",
    "EXCLUDE_COMPARISON_TABLE",
    "EXCLUDE_RELATED",
    "EXCLUDE_COMMENT",
    "EXCLUDE_FOOTER",
]


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
def synthetic_html() -> str:
    return (FIXTURES / "synthetic_article.html").read_text(encoding="utf-8")


def test_extracts_article_title(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    assert document.title == "סינטטיקה ZX – מבחן דרכים"  # noqa: RUF001 (en dash is real content)


def test_metadata_comes_from_manifest_not_prose(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    assert document.vehicle_id == "synthetic_zx"
    assert document.vehicle.make == "Synthetic"
    assert document.vehicle.model_year is None
    assert document.article_type is ArticleType.ROAD_TEST


def test_lead_text_becomes_introduction_section(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    intro = document.sections[0]
    assert intro.heading == INTRODUCTION_HEADING
    assert len(intro.paragraphs) == 2


def test_extracts_headed_sections_in_order(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    headings = [section.heading for section in document.sections]
    assert headings == [
        INTRODUCTION_HEADING,
        "איך העיצוב של סינטטיקה ZX?",
        "איך הנוחות וההתנהגות?",
    ]
    for section in document.sections:
        assert len(section.paragraphs) == 2


def test_inline_links_are_flattened_to_plain_text(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    all_text = normalized_content(document)
    assert "קישור פנימי" in all_text
    assert "<a" not in all_text
    assert "href" not in all_text


def test_forbidden_blocks_are_excluded(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    serialized = document.model_dump_json()
    for sentinel in EXCLUDED_SENTINELS:
        assert sentinel not in serialized, f"excluded content leaked into output: {sentinel}"


def test_extraction_is_deterministic(synthetic_html: str) -> None:
    first = extract_document(synthetic_html, _source())
    second = extract_document(synthetic_html, _source())
    assert first == second
    assert normalized_content(first) == normalized_content(second)


def test_extracts_qa_pairs_tagged_as_publisher_faq(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    assert len(document.qa_pairs) == 2
    first = document.qa_pairs[0]
    assert first.question == "מה המחיר של סינטטיקה ZX?"
    assert "123,456" in first.answer
    assert all(pair.source is QASource.PUBLISHER_FAQ for pair in document.qa_pairs)


def test_extracts_pros_cons_mapped_by_title(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    assert document.pros_cons is not None
    # Mapped by column title, not by position.
    assert document.pros_cons.pros == [
        "תמחור אטרקטיבי",
        "טווח חשמלי טוב",
        "בידוד רעשים מצוין",
    ]
    assert document.pros_cons.cons == ["ממשק משתמש מסורבל", "אין טעינה מהירה"]


def test_qa_and_pros_cons_absent_yield_empty_and_none() -> None:
    html = (
        "<html dir='rtl'><body><h1>כותרת ללא בלוקים</h1>"
        "<div class='article-rte-section'><div class='text-wrapper'>"
        "<h2>מקטע</h2>"
        f"<p>{'טקסט תוכן ארוך מספיק כדי לעבור את סף המינימום. ' * 40}</p>"
        "</div></div></body></html>"
    )
    document = extract_document(html, _source())
    assert document.qa_pairs == []
    assert document.pros_cons is None


def test_competitor_comparison_table_stays_excluded(synthetic_html: str) -> None:
    # The pros/cons table is included, but the separate vehicle-table must not be.
    document = extract_document(synthetic_html, _source())
    assert "EXCLUDE_COMPARISON_TABLE" not in document.model_dump_json()


def test_extracts_published_and_modified_from_json_ld(synthetic_html: str) -> None:
    document = extract_document(synthetic_html, _source())
    assert document.published_at == datetime(2026, 2, 5, 9, 0, tzinfo=UTC)
    assert document.modified_at == datetime(2026, 3, 10, 12, 30, tzinfo=UTC)


def test_falls_back_to_time_element_when_json_ld_absent(synthetic_html: str) -> None:
    # Drop the JSON-LD block; the visible <time> element supplies the published date only.
    start = synthetic_html.index("<script type=")
    end = synthetic_html.index("</script>") + len("</script>")
    html_without_json_ld = synthetic_html[:start] + synthetic_html[end:]

    document = extract_document(html_without_json_ld, _source())
    assert document.published_at == datetime(2026, 2, 5)  # date-only, naive
    assert document.modified_at is None


def test_missing_dates_yield_none_without_failing_acceptance() -> None:
    html = (
        "<html dir='rtl'><body><h1>כותרת ללא תאריך</h1>"
        "<div class='article-rte-section'><div class='text-wrapper'>"
        "<h2>מקטע</h2>"
        f"<p>{'טקסט תוכן ארוך מספיק כדי לעבור את סף המינימום. ' * 40}</p>"
        "</div></div></body></html>"
    )
    document = extract_document(html, _source())
    assert document.published_at is None
    assert document.modified_at is None


def test_missing_title_raises(synthetic_html: str) -> None:
    html_without_h1 = synthetic_html.replace("<h1>", "<span>").replace("</h1>", "</span>")
    with pytest.raises(ExtractionError, match="title"):
        extract_document(html_without_h1, _source())


def test_missing_body_raises() -> None:
    html = "<html dir='rtl'><body><h1>כותרת בלבד</h1></body></html>"
    with pytest.raises(ExtractionError, match="body"):
        extract_document(html, _source())


def test_content_below_minimum_raises() -> None:
    html = (
        "<html dir='rtl'><body><h1>כותרת קצרה</h1>"
        "<div class='article-rte-section'><div class='text-wrapper'>"
        "<h2>מקטע</h2><p>טקסט קצר מדי.</p>"
        "</div></div></body></html>"
    )
    with pytest.raises(ExtractionError, match="too short"):
        extract_document(html, _source())
