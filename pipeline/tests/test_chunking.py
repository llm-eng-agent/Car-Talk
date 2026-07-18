"""Tests for the structure-aware chunker (offline: token counter is injected)."""

from __future__ import annotations

from car_talk_pipeline.chunking import (
    HARD_MAX,
    PROS_CONS_HEADING,
    QA_HEADING,
    ContentType,
    chunk_document,
    embedding_text,
)
from car_talk_pipeline.models import (
    ArticleType,
    CanonicalDocument,
    CoverageScope,
    ProsCons,
    QAPair,
    Section,
    SourceEntry,
    Vehicle,
)


def word_count(text: str) -> int:
    """Deterministic offline token counter used in place of tiktoken."""

    return len(text.split())


def words(n: int) -> str:
    return " ".join(["w"] * n)


def sentence(n_words: int) -> str:
    return " ".join(["word"] * n_words) + "."


def _source() -> SourceEntry:
    return SourceEntry(
        document_id="doc1",
        vehicle_id="veh1",
        canonical_name="Test Vehicle",
        make="Testum",
        model="X",
        model_year=2026,
        article_type=ArticleType.ROAD_TEST,
        coverage_scope=CoverageScope.FULL_REVIEW,
        url="https://www.auto.co.il/articles/test-drives/road-tests/x/",
    )


def _document(
    sections: list[Section],
    qa_pairs: list[QAPair] | None = None,
    pros_cons: ProsCons | None = None,
) -> CanonicalDocument:
    return CanonicalDocument(
        document_id="doc1",
        vehicle_id="veh1",
        url="https://www.auto.co.il/articles/test-drives/road-tests/x/",
        title="Test Article",
        article_type=ArticleType.ROAD_TEST,
        coverage_scope=CoverageScope.FULL_REVIEW,
        vehicle=Vehicle(make="Testum", model="X", model_year=2026),
        sections=sections,
        qa_pairs=qa_pairs or [],
        pros_cons=pros_cons,
    )


def test_small_section_becomes_one_chunk() -> None:
    doc = _document([Section(heading="A", paragraphs=[words(50), words(50)])])
    chunks = chunk_document(doc, _source(), word_count)
    assert len(chunks) == 1
    assert chunks[0].content_type is ContentType.SECTION
    assert chunks[0].section_heading == "A"
    assert chunks[0].token_count == word_count(chunks[0].content)


def test_section_at_500_stays_one_chunk() -> None:
    doc = _document([Section(heading="A", paragraphs=[words(250), words(248)])])
    chunks = chunk_document(doc, _source(), word_count)
    assert len(chunks) == 1  # whole section <= 500 tokens


def test_large_section_packs_by_paragraph_under_hard_max() -> None:
    doc = _document([Section(heading="A", paragraphs=[words(300), words(300), words(300)])])
    chunks = chunk_document(doc, _source(), word_count)
    assert len(chunks) >= 2
    for chunk in chunks:
        assert chunk.token_count <= HARD_MAX


def test_oversized_paragraph_split_at_sentence_boundaries() -> None:
    big_paragraph = " ".join(sentence(200) for _ in range(3))  # ~600 tokens, 3 sentences
    doc = _document([Section(heading="A", paragraphs=[big_paragraph])])
    chunks = chunk_document(doc, _source(), word_count)
    assert len(chunks) >= 2
    for chunk in chunks:
        assert chunk.token_count <= HARD_MAX


def test_chunks_never_cross_sections() -> None:
    doc = _document(
        [
            Section(heading="A", paragraphs=[words(40)]),
            Section(heading="B", paragraphs=[words(40)]),
        ]
    )
    chunks = chunk_document(doc, _source(), word_count)
    headings = {chunk.section_heading for chunk in chunks}
    assert headings == {"A", "B"}
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_qa_pairs_chunked_as_tagged_block() -> None:
    doc = _document(
        [Section(heading="A", paragraphs=[words(40)])],
        qa_pairs=[QAPair(question="מה המחיר?", answer="123 שקלים")],
    )
    chunks = chunk_document(doc, _source(), word_count)
    qa = [c for c in chunks if c.content_type is ContentType.QA]
    assert len(qa) == 1
    assert qa[0].section_heading == QA_HEADING
    assert qa[0].provenance == "publisher_faq"
    assert "מה המחיר?" in qa[0].content


def test_pros_cons_chunked_as_tagged_block() -> None:
    doc = _document(
        [Section(heading="A", paragraphs=[words(40)])],
        pros_cons=ProsCons(pros=["מהיר", "חסכוני"], cons=["יקר"]),
    )
    chunks = chunk_document(doc, _source(), word_count)
    pc = [c for c in chunks if c.content_type is ContentType.PROS_CONS]
    assert len(pc) == 1
    assert pc[0].section_heading == PROS_CONS_HEADING
    assert "מהיר" in pc[0].content and "יקר" in pc[0].content


def test_chunking_is_deterministic() -> None:
    doc = _document([Section(heading="A", paragraphs=[words(300), words(300)])])
    assert chunk_document(doc, _source(), word_count) == chunk_document(doc, _source(), word_count)


def test_embedding_text_uses_locked_format() -> None:
    doc = _document([Section(heading="נוחות", paragraphs=[words(30)])])
    chunk = chunk_document(doc, _source(), word_count)[0]
    text = embedding_text(chunk)
    assert text.startswith("רכב: Test Vehicle\nכתבה: Test Article\nנושא: נוחות\n\n")
    assert chunk.content in text
