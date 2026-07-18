"""Canonical data models for ingestion.

These models are the contract between extraction (this module's producers) and every
downstream stage (chunking, embedding, indexing). Vehicle identity is curated in the
source manifest, never guessed from article prose (spec section 5, "Locked Contract").
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError


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


# --- Evaluation dataset (data/eval_queries.json, spec section 18) --------------------


class Aspect(StrEnum):
    """Approved aspect vocabulary (spec section 11.5, Locked Contract).

    The only tokens allowed in an eval query's ``relevant_aspects``. The spec section 18.2
    example uses ad-hoc terms (``interior_space``/``practicality``) that are NOT in this
    vocabulary; use ``space_practicality`` / ``interior_quality`` instead.
    """

    RIDE_COMFORT = "ride_comfort"
    SPACE_PRACTICALITY = "space_practicality"
    PERFORMANCE = "performance"
    HANDLING = "handling"
    INTERIOR_QUALITY = "interior_quality"
    USABILITY_ERGONOMICS = "usability_ergonomics"
    EFFICIENCY_RANGE = "efficiency_range"
    REFINEMENT = "refinement"
    VALUE_FOR_MONEY = "value_for_money"
    SAFETY_EQUIPMENT = "safety_equipment"
    DESIGN = "design"


class QueryType(StrEnum):
    """Golden-set query category (spec section 18.1 distribution)."""

    SINGLE_VEHICLE = "single_vehicle"
    COMPARISON = "comparison"
    RECOMMENDATION = "recommendation"
    UNANSWERABLE = "unanswerable"
    FOLLOW_UP = "follow_up"


class ExpectedDecision(StrEnum):
    """Expected answer shape for a query.

    ``informational`` (single-vehicle fact), ``trade_off`` (comparison, spec section 18.2),
    ``recommend`` (recommendation), ``abstain`` (unanswerable / out-of-corpus).
    """

    INFORMATIONAL = "informational"
    TRADE_OFF = "trade_off"
    RECOMMEND = "recommend"
    ABSTAIN = "abstain"


class EvalContextTurn(BaseModel):
    """One prior conversation turn, for follow-up/memory queries (spec section 18.1)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    role: str = Field(min_length=1)
    text: str = Field(min_length=1)


class EvalQuery(BaseModel):
    """One labeled Hebrew golden-set query (spec section 18.2).

    ``expected_vehicle_ids`` and the keys of ``relevant_chunk_ids`` are ``vehicle_id`` values
    (as in the Qdrant payload); ``relevant_chunk_ids`` values are real ``chunk_id`` strings
    (``{document_id}::b{block}::c{piece}``). Unanswerable queries carry empty
    ``relevant_chunk_ids`` and ``expected_decision == abstain``.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    query_type: QueryType
    query: str = Field(min_length=1)
    context: list[EvalContextTurn] = Field(default_factory=list)
    expected_vehicle_ids: list[str] = Field(default_factory=list)
    relevant_aspects: list[Aspect] = Field(default_factory=list)
    relevant_chunk_ids: dict[str, list[str]] = Field(default_factory=dict)
    expected_answer_points: list[str] = Field(default_factory=list)
    expected_decision: ExpectedDecision
    forbidden_claims: list[str] = Field(default_factory=list)


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


# --- Evaluation dataset loading (data/eval_queries.json) -----------------------------


_EVAL_ADAPTER = TypeAdapter(list[EvalQuery])


def load_eval_dataset(path: Path) -> list[EvalQuery]:
    """Load and validate the Hebrew golden evaluation set (spec section 18).

    Raises:
        ManifestError: If the file is missing, is not valid JSON matching the schema, or
            contains duplicate query ids.
    """

    if not path.is_file():
        raise ManifestError(f"Eval dataset not found: {path}")

    try:
        queries = _EVAL_ADAPTER.validate_json(path.read_text(encoding="utf-8"))
    except ValidationError as error:
        raise ManifestError(f"Invalid eval dataset {path}: {error}") from error

    ids = [query.id for query in queries]
    duplicates = {qid for qid in ids if ids.count(qid) > 1}
    if duplicates:
        raise ManifestError(f"Duplicate query ids in eval dataset: {sorted(duplicates)}")

    return queries
