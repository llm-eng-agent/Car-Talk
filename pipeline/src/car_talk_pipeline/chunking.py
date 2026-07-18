"""Structure-aware chunking of canonical documents

Rules (locked): soft target 400 tokens, packing target up to 450 using complete
consecutive paragraphs, hard maximum 500. A section at or below 500 tokens is one chunk;
above 500 it is greedily packed by complete paragraph; a single paragraph above 500 is
split only at sentence boundaries. Chunks never cross section boundaries; overlap is zero."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from car_talk_pipeline.models import CanonicalDocument, SourceEntry

PACK_TARGET = 450
HARD_MAX = 500

_PARAGRAPH_JOIN = "\n\n"
_SENTENCE_JOIN = " "
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")

QA_HEADING = "שאלות ותשובות"
PROS_CONS_HEADING = "יתרונות וחסרונות"
PUBLISHER_FAQ_PROVENANCE = "publisher_faq"


# --- Models -------------------------------------------------------------------------


class ContentType(StrEnum):
    """Which part of the document a chunk came from."""

    SECTION = "section"
    QA = "qa"
    PROS_CONS = "pros_cons"


class Chunk(BaseModel):
    """One retrievable unit of a document"""

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


# --- Token counting -----------------------------------------------------------------


class TokenCounter(Protocol):
    def __call__(self, text: str) -> int: ...


class TiktokenCounter:
    """Counts tokens with the encoding tiktoken selects for the embedding model.

    Encoding data loads lazily on first use, so this is only built in the live pipeline
    path, never in offline tests.
    """

    def __init__(self, model: str = "text-embedding-3-small") -> None:
        import tiktoken

        self._encoding = tiktoken.encoding_for_model(model)

    def __call__(self, text: str) -> int:
        return len(self._encoding.encode(text))


# --- Chunking -----------------------------------------------------------------------


@dataclass(frozen=True)
class _Block:
    """A heading + ordered text units chunked as one section."""

    heading: str
    units: list[str]
    content_type: ContentType
    provenance: str | None


def _split_into_sentences(paragraph: str) -> list[str]:
    return [part for part in _SENTENCE_BOUNDARY.split(paragraph.strip()) if part]


def _pack_units(units: list[str], joiner: str, count: TokenCounter) -> list[str]:
    """Greedily pack whole units into pieces at or below the packing target.

    A unit larger than the hard maximum is emitted on its own (callers pre-split
    paragraphs into sentences before reaching this point).
    """

    pieces: list[str] = []
    current: list[str] = []
    for unit in units:
        if count(unit) > HARD_MAX:
            if current:
                pieces.append(joiner.join(current))
                current = []
            pieces.append(unit)
            continue
        candidate = [*current, unit]
        if current and count(joiner.join(candidate)) > PACK_TARGET:
            pieces.append(joiner.join(current))
            current = [unit]
        else:
            current = candidate
    if current:
        pieces.append(joiner.join(current))
    return pieces


def _pack_paragraphs(paragraphs: list[str], count: TokenCounter) -> list[str]:
    """Chunk one block's paragraphs into piece texts."""

    whole = _PARAGRAPH_JOIN.join(paragraphs)
    if count(whole) <= HARD_MAX:
        return [whole]

    pieces: list[str] = []
    current: list[str] = []
    for paragraph in paragraphs:
        if count(paragraph) > HARD_MAX:
            if current:
                pieces.append(_PARAGRAPH_JOIN.join(current))
                current = []
            # Oversized paragraph: split at sentence boundaries only.
            pieces.extend(_pack_units(_split_into_sentences(paragraph), _SENTENCE_JOIN, count))
            continue
        candidate = [*current, paragraph]
        if current and count(_PARAGRAPH_JOIN.join(candidate)) > PACK_TARGET:
            pieces.append(_PARAGRAPH_JOIN.join(current))
            current = [paragraph]
        else:
            current = candidate
    if current:
        pieces.append(_PARAGRAPH_JOIN.join(current))
    return pieces


def _build_blocks(document: CanonicalDocument) -> list[_Block]:
    blocks: list[_Block] = [
        _Block(section.heading, list(section.paragraphs), ContentType.SECTION, None)
        for section in document.sections
    ]
    if document.qa_pairs:
        qa_units = [f"ש: {pair.question}\nת: {pair.answer}" for pair in document.qa_pairs]
        blocks.append(_Block(QA_HEADING, qa_units, ContentType.QA, PUBLISHER_FAQ_PROVENANCE))
    if document.pros_cons is not None:
        pros = "יתרונות:\n" + "\n".join(f"- {item}" for item in document.pros_cons.pros)
        cons = "חסרונות:\n" + "\n".join(f"- {item}" for item in document.pros_cons.cons)
        blocks.append(_Block(PROS_CONS_HEADING, [pros, cons], ContentType.PROS_CONS, None))
    return blocks


def chunk_document(
    document: CanonicalDocument,
    source: SourceEntry,
    count: TokenCounter,
) -> list[Chunk]:
    """Chunk a canonical document into ordered, section-bounded chunks."""

    chunks: list[Chunk] = []
    chunk_index = 0
    for block_index, block in enumerate(_build_blocks(document)):
        for piece_index, content in enumerate(_pack_paragraphs(block.units, count)):
            chunks.append(
                Chunk(
                    chunk_id=f"{document.document_id}::b{block_index}::c{piece_index}",
                    document_id=document.document_id,
                    vehicle_id=document.vehicle_id,
                    vehicle_make=document.vehicle.make,
                    vehicle_model=document.vehicle.model,
                    model_year=document.vehicle.model_year,
                    canonical_vehicle_name=source.canonical_name,
                    article_title=document.title,
                    section_heading=block.heading,
                    chunk_index=chunk_index,
                    content=content,
                    source_url=document.url,
                    token_count=count(content),
                    content_type=block.content_type,
                    provenance=block.provenance,
                )
            )
            chunk_index += 1
    return chunks


def embedding_text(chunk: Chunk) -> str:
    """Build the enriched embedding text."""

    return (
        f"רכב: {chunk.canonical_vehicle_name}\n"
        f"כתבה: {chunk.article_title}\n"
        f"נושא: {chunk.section_heading}\n\n"
        f"{chunk.content}"
    )
