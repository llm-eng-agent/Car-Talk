"""Canonical data models for ingestion.

These models are the contract between extraction (this module's producers) and every
downstream stage (chunking, embedding, indexing). Vehicle identity is curated in the
source manifest, never guessed from article prose (spec section 5, "Locked Contract").
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class ArticleType(StrEnum):
    """Editorial type of a review article (spec: Locked Contract / source ingestion)."""

    ROAD_TEST = "road_test"
    LONG_TERM_REPORT = "long_term_report"


class CoverageScope(StrEnum):
    """How complete the article's coverage of the vehicle is."""

    FULL_REVIEW = "full_review"
    PARTIAL_UPDATE = "partial_update"


class SourceEntry(BaseModel):
    """One curated entry in ``data/sources.json``.

    Holds the canonical vehicle identity and article metadata. The URL list is kept
    separate from spider logic (spec section 5.5) so the manifest is the single source
    of truth for what gets ingested.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    document_id: str = Field(min_length=1)
    vehicle_id: str = Field(min_length=1)
    canonical_name: str = Field(min_length=1)
    make: str = Field(min_length=1)
    model: str = Field(min_length=1)
    model_year: int | None = None
    article_type: ArticleType
    coverage_scope: CoverageScope
    url: str = Field(min_length=1)
    enabled: bool = True


class SourcesManifest(BaseModel):
    """Top-level structure of ``data/sources.json``."""

    model_config = ConfigDict(extra="forbid")

    sources: list[SourceEntry]

    def enabled_sources(self) -> list[SourceEntry]:
        return [source for source in self.sources if source.enabled]


class Vehicle(BaseModel):
    """Vehicle identity as stored on a canonical document (spec section 6.2)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    make: str
    model: str
    model_year: int | None = None
    trim: str | None = None


class Section(BaseModel):
    """A heading and its ordered paragraphs (spec section 6.2).

    The pre-heading lead text is stored as a section whose heading is
    ``INTRODUCTION_HEADING`` (spec section 6.3).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    heading: str = Field(min_length=1)
    paragraphs: list[str] = Field(min_length=1)


class QASource(StrEnum):
    """Provenance of a question/answer pair.

    ``PUBLISHER_FAQ`` marks the article's structured FAQ accordion, which may be
    AI-assisted rather than reviewer prose. Tagging keeps that distinction explicit so
    downstream citations can present it as publisher FAQ, not the reviewer's assessment
    (see docs/adr/0001).
    """

    PUBLISHER_FAQ = "publisher_faq"


class QAPair(BaseModel):
    """One question/answer pair from an article's FAQ block."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    source: QASource = QASource.PUBLISHER_FAQ


class ProsCons(BaseModel):
    """The reviewer's pros/cons verdict table, distinct from the article prose."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    pros: list[str]
    cons: list[str]


class CanonicalDocument(BaseModel):
    """One article, one document (spec section 6.1).

    Contains only textual article content: title, introduction, headings and ordered
    paragraphs. No images, comments, navigation, ads, or existing AI summaries.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    document_id: str
    vehicle_id: str
    url: str
    title: str
    article_type: ArticleType
    coverage_scope: CoverageScope
    vehicle: Vehicle
    sections: list[Section]
    # Structured supplementary blocks, kept separate from the prose sections so their
    # provenance stays explicit (see docs/adr/0001). Best-effort: empty/None when the
    # article lacks them, never guessed. Both are substantive evidence and are included
    # in the content hash.
    qa_pairs: list[QAPair] = Field(default_factory=list)
    pros_cons: ProsCons | None = None
    # Publication and last-modified timestamps, when the article exposes them. Used as a
    # recency signal ("age" of the review). Best-effort: null when absent, never guessed
    # (spec section 6.4). Excluded from the content hash so a modified-date-only change
    # does not mark the text as updated.
    published_at: datetime | None = None
    modified_at: datetime | None = None


class RunRecord(BaseModel):
    """One line in the JSONL run manifest (spec section 5.6, "Locked Contract").

    Records ingestion status, hashes, and errors. Idempotency is based on
    ``normalized_content_sha256`` plus ``pipeline_version``. No ingestion registry
    database is used.
    """

    model_config = ConfigDict(extra="forbid")

    document_id: str
    url: str
    status: str
    pipeline_version: str
    raw_html_sha256: str | None = None
    normalized_content_sha256: str | None = None
    content_char_count: int | None = None
    section_count: int | None = None
    timestamp: str
    error: str | None = None


# --- Sources manifest loading (data/sources.json) -----------------------------------


class ManifestError(Exception):
    """Raised when the sources manifest is missing, malformed, or inconsistent."""


def load_manifest(manifest_path: Path) -> SourcesManifest:
    """Load and validate the sources manifest.

    Raises:
        ManifestError: If the file is missing, is not valid JSON matching the schema,
            or contains duplicate ``document_id`` values.
    """

    if not manifest_path.is_file():
        raise ManifestError(f"Sources manifest not found: {manifest_path}")

    raw_json = manifest_path.read_text(encoding="utf-8")
    try:
        manifest = SourcesManifest.model_validate_json(raw_json)
    except ValidationError as error:
        raise ManifestError(f"Invalid sources manifest {manifest_path}: {error}") from error

    document_ids = [source.document_id for source in manifest.sources]
    duplicates = {doc_id for doc_id in document_ids if document_ids.count(doc_id) > 1}
    if duplicates:
        raise ManifestError(f"Duplicate document_id values in manifest: {sorted(duplicates)}")

    return manifest


def find_source(manifest: SourcesManifest, document_id: str) -> SourceEntry:
    """Return the source entry for ``document_id``.

    Raises:
        ManifestError: If no entry has the given ``document_id``.
    """

    for source in manifest.sources:
        if source.document_id == document_id:
            return source
    raise ManifestError(f"No source with document_id {document_id!r} in manifest")
