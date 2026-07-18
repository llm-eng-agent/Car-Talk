"""Chunk model (spec section 7.7)."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class ContentType(StrEnum):
    """Which part of the document a chunk came from."""

    SECTION = "section"
    QA = "qa"
    PROS_CONS = "pros_cons"


class Chunk(BaseModel):
    """One retrievable unit of a document.

    ``content`` is the original text; the enriched embedding text (vehicle/article/section
    header) is built separately at embedding time (spec section 7.6). ``content_type`` and
    ``provenance`` preserve the distinction between reviewer prose and the publisher FAQ /
    pros-cons blocks (see docs/adr/0001).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    chunk_id: str
    document_id: str
    vehicle_id: str
    vehicle_make: str
    vehicle_model: str
    model_year: int | None
    canonical_vehicle_name: str
    article_title: str
    section_heading: str
    chunk_index: int
    content: str = Field(min_length=1)
    source_url: str
    token_count: int
    content_type: ContentType
    provenance: str | None = None
