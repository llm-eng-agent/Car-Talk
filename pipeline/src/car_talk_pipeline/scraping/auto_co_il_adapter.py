"""Deterministic extraction of Auto.co.il review articles into canonical documents.

This adapter owns the exact CSS selectors for the Auto.co.il article template. Selector
spelling is an implementation detail; the extraction acceptance rules enforced here (and
the tests in ``tests/test_auto_co_il_adapter.py``) are the binding contract
(spec: Locked Contract / source ingestion).

The adapter is pure and network-free: it turns an HTML string into a
``CanonicalDocument``. No LLM is used (spec section 6.5). Vehicle identity comes from the
curated ``SourceEntry`` manifest, never from article prose.

Extraction strategy (validated against the live MG S6 page):
- Article prose lives inside ``div.article-rte-section`` blocks. Everything else on the
  page (navigation, image galleries, comparison tables, comments, the existing AI/FAQ
  summary, ads, related cards) sits in other containers and is therefore excluded simply
  by scoping extraction to those blocks.
- Within the prose, ``<h2>`` starts a section and ``<p>`` adds a paragraph, walked in
  document order. Text before the first ``<h2>`` becomes the introduction section.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from parsel import Selector, SelectorList

from car_talk_pipeline.scraping.models import (
    CanonicalDocument,
    ProsCons,
    QAPair,
    Section,
    SourceEntry,
    Vehicle,
)

# --- Selectors (implementation detail; see module docstring) ------------------------
TITLE_CSS = "h1"
ARTICLE_BODY_CSS = "div.article-rte-section"
HEADING_XPATH = ".//h2"
PARAGRAPH_XPATH = ".//p"

# --- Extraction acceptance thresholds (binding contract) ----------------------------
MIN_CONTENT_CHARS = 1000

# Internal heading for lead text appearing before the first article heading
# (spec section 6.3).
INTRODUCTION_HEADING = "introduction"

# Publication date sources, in priority order: structured JSON-LD (precise, includes a
# modified timestamp) first, then the visible article meta ``<time>`` element as a
# published-only fallback.
JSON_LD_CSS = 'script[type="application/ld+json"]::text'
PUBLISHED_TIME_CSS = "time.article-meta__date::attr(datetime)"

# Structured supplementary blocks (outside the article prose). Optional per article.
QA_ITEM_CSS = ".faq__body .spollers__item"
QA_QUESTION_CSS = ".spollers__title"
QA_ANSWER_CSS = ".spollers__body"
PROS_CONS_COL_CSS = ".pros-cons-table__col"
PROS_CONS_TITLE_CSS = ".pros-cons-table__title"
# Column-title keywords that identify the pros vs cons column (mapped by title, not order).
PROS_TITLE_KEYWORD = "יתרונות"
CONS_TITLE_KEYWORD = "חסרונות"

_WHITESPACE_RE = re.compile(r"\s+")


class ExtractionError(Exception):
    """Raised when an article fails the extraction acceptance rules.

    Failing early (rather than emitting a partial document) keeps a broken source
    visible instead of silently indexing degraded content (spec section 5.3).
    """


def _normalize_text(raw_text: str) -> str:
    """Collapse all whitespace (including non-breaking spaces) into single spaces."""

    return _WHITESPACE_RE.sub(" ", raw_text.replace("\xa0", " ")).strip()


def _node_text(node: Selector) -> str:
    """Concatenate all descendant text of a node and normalize whitespace.

    Descendant text includes content inside inline ``<a>`` and ``<strong>`` tags, so
    links and emphasis are flattened to plain text without losing words.
    """

    return _normalize_text("".join(node.css("::text").getall()))


def _extract_sections(body_nodes: SelectorList[Selector]) -> list[Section]:
    """Walk headings and paragraphs in document order into ordered sections."""

    heading_and_paragraph_nodes = body_nodes.xpath(f"{HEADING_XPATH} | {PARAGRAPH_XPATH}")

    sections: list[Section] = []
    current_heading = INTRODUCTION_HEADING
    current_paragraphs: list[str] = []

    def flush() -> None:
        # A heading with no paragraphs is structural noise, not a content section.
        if current_paragraphs:
            sections.append(Section(heading=current_heading, paragraphs=list(current_paragraphs)))

    for node in heading_and_paragraph_nodes:
        tag = node.root.tag
        text = _node_text(node)
        if tag == "h2":
            if not text:
                continue
            flush()
            current_heading = text
            current_paragraphs = []
        elif tag == "p" and text:
            current_paragraphs.append(text)

    flush()
    return sections


def _content_char_count(sections: list[Section]) -> int:
    """Total characters of extracted textual content, used for the acceptance rule."""

    return sum(
        len(section.heading) + sum(len(p) for p in section.paragraphs) for section in sections
    )


def _parse_iso_datetime(value: object) -> datetime | None:
    """Parse an ISO-8601 string (including a trailing ``Z``) into a datetime, or None."""

    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _iter_json_ld_objects(data: Any) -> list[dict[str, Any]]:
    """Yield candidate objects from a parsed JSON-LD payload (handles ``@graph`` and lists)."""

    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        graph = data.get("@graph")
        if isinstance(graph, list):
            return [item for item in graph if isinstance(item, dict)]
        return [data]
    return []


def _dates_from_json_ld(selector: Selector) -> tuple[datetime | None, datetime | None]:
    """Read ``datePublished``/``dateModified`` from the first JSON-LD object that has them."""

    for raw in selector.css(JSON_LD_CSS).getall():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # A malformed JSON-LD block is skipped rather than failing extraction.
            continue
        for obj in _iter_json_ld_objects(data):
            if "datePublished" in obj:
                return (
                    _parse_iso_datetime(obj.get("datePublished")),
                    _parse_iso_datetime(obj.get("dateModified")),
                )
    return None, None


def _extract_dates(selector: Selector) -> tuple[datetime | None, datetime | None]:
    """Extract (published_at, modified_at); best-effort, missing values are None."""

    published_at, modified_at = _dates_from_json_ld(selector)
    if published_at is None:
        published_at = _parse_iso_datetime(selector.css(PUBLISHED_TIME_CSS).get())
    return published_at, modified_at


def _extract_qa_pairs(selector: Selector) -> list[QAPair]:
    """Extract the FAQ accordion as question/answer pairs (best-effort, empty if absent)."""

    pairs: list[QAPair] = []
    for item in selector.css(QA_ITEM_CSS):
        question = _normalize_text("".join(item.css(f"{QA_QUESTION_CSS} ::text").getall()))
        answer = _normalize_text("".join(item.css(f"{QA_ANSWER_CSS} ::text").getall()))
        if question and answer:
            pairs.append(QAPair(question=question, answer=answer))
    return pairs


def _extract_pros_cons(selector: Selector) -> ProsCons | None:
    """Extract the pros/cons verdict table, mapping columns by title (not position).

    Returns None when no such table exists or both lists come out empty.
    """

    pros: list[str] = []
    cons: list[str] = []
    matched_a_column = False
    for column in selector.css(PROS_CONS_COL_CSS):
        title = _normalize_text("".join(column.css(f"{PROS_CONS_TITLE_CSS} ::text").getall()))
        items = [_normalize_text("".join(li.css("::text").getall())) for li in column.css("li")]
        items = [item for item in items if item]
        if PROS_TITLE_KEYWORD in title:
            pros.extend(items)
            matched_a_column = True
        elif CONS_TITLE_KEYWORD in title:
            cons.extend(items)
            matched_a_column = True

    if not matched_a_column or (not pros and not cons):
        return None
    return ProsCons(pros=pros, cons=cons)


def extract_document(html: str, source: SourceEntry) -> CanonicalDocument:
    """Extract a canonical document from article HTML.

    Args:
        html: Raw HTML of the article page.
        source: Curated manifest entry providing canonical vehicle identity and metadata.

    Returns:
        A validated ``CanonicalDocument``.

    Raises:
        ExtractionError: If the page fails any extraction acceptance rule (missing title,
            no content sections, or fewer than ``MIN_CONTENT_CHARS`` content characters).
    """

    selector = Selector(text=html)

    title = _normalize_text(" ".join(selector.css(f"{TITLE_CSS} ::text").getall()))
    if not title:
        raise ExtractionError(f"No article title found for {source.url}")

    body_nodes = selector.css(ARTICLE_BODY_CSS)
    if not body_nodes:
        raise ExtractionError(f"No article body ({ARTICLE_BODY_CSS!r}) found for {source.url}")

    sections = _extract_sections(body_nodes)
    if not sections:
        raise ExtractionError(f"No content sections extracted for {source.url}")

    char_count = _content_char_count(sections)
    if char_count < MIN_CONTENT_CHARS:
        raise ExtractionError(
            f"Extracted content too short for {source.url}: "
            f"{char_count} chars < {MIN_CONTENT_CHARS} required"
        )

    published_at, modified_at = _extract_dates(selector)

    return CanonicalDocument(
        document_id=source.document_id,
        vehicle_id=source.vehicle_id,
        url=source.url,
        title=title,
        article_type=source.article_type,
        coverage_scope=source.coverage_scope,
        vehicle=Vehicle(make=source.make, model=source.model, model_year=source.model_year),
        sections=sections,
        qa_pairs=_extract_qa_pairs(selector),
        pros_cons=_extract_pros_cons(selector),
        published_at=published_at,
        modified_at=modified_at,
    )


def normalized_content(document: CanonicalDocument) -> str:
    """Build the canonical normalized-text representation used for hashing.

    Deterministic: heading followed by its paragraphs, sections separated by blank lines.
    """

    blocks: list[str] = []
    for section in document.sections:
        blocks.append("\n".join([section.heading, *section.paragraphs]))
    for pair in document.qa_pairs:
        blocks.append("\n".join([pair.question, pair.answer]))
    if document.pros_cons is not None:
        blocks.append(
            "\n".join(
                [
                    PROS_TITLE_KEYWORD,
                    *document.pros_cons.pros,
                    CONS_TITLE_KEYWORD,
                    *document.pros_cons.cons,
                ]
            )
        )
    return "\n\n".join(blocks)
