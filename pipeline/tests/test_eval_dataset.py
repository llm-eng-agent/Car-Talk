"""Integrity tests for the committed Hebrew golden eval set (spec section 18).

Structural checks run offline in CI (they need only the committed ``data/*.json``). The
on-disk gold-chunk existence check is skipped when ``.tmp/chunks`` is absent (CI), and
catches label typos when run locally.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from car_talk_pipeline.models import (
    Aspect,
    EvalQuery,
    ExpectedDecision,
    QueryType,
    load_eval_dataset,
    load_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_PATH = REPO_ROOT / "data" / "eval_queries.json"
MANIFEST_PATH = REPO_ROOT / "data" / "sources.json"
CHUNKS_DIR = REPO_ROOT / ".tmp" / "chunks"

# Spec section 18.1 distribution.
EXPECTED_DISTRIBUTION = {
    QueryType.SINGLE_VEHICLE: 10,
    QueryType.COMPARISON: 8,
    QueryType.RECOMMENDATION: 6,
    QueryType.UNANSWERABLE: 3,
    QueryType.FOLLOW_UP: 3,
}


@pytest.fixture(scope="module")
def queries() -> list[EvalQuery]:
    return load_eval_dataset(EVAL_PATH)


@pytest.fixture(scope="module")
def vehicle_to_document() -> dict[str, str]:
    manifest = load_manifest(MANIFEST_PATH)
    return {source.vehicle_id: source.document_id for source in manifest.sources}


def test_dataset_has_30_unique_queries(queries: list[EvalQuery]) -> None:
    assert len(queries) == 30
    ids = [q.id for q in queries]
    assert len(set(ids)) == 30


def test_distribution_matches_spec(queries: list[EvalQuery]) -> None:
    counts = Counter(q.query_type for q in queries)
    assert dict(counts) == EXPECTED_DISTRIBUTION


def test_vehicle_ids_resolve_to_manifest(
    queries: list[EvalQuery], vehicle_to_document: dict[str, str]
) -> None:
    known = set(vehicle_to_document)
    for q in queries:
        for vid in q.expected_vehicle_ids:
            assert vid in known, f"{q.id}: unknown vehicle_id {vid!r}"
        for vid in q.relevant_chunk_ids:
            assert vid in known, f"{q.id}: unknown relevant_chunk_ids key {vid!r}"


def test_chunk_id_shape_and_document_match(
    queries: list[EvalQuery], vehicle_to_document: dict[str, str]
) -> None:
    for q in queries:
        for vid, chunk_ids in q.relevant_chunk_ids.items():
            document_id = vehicle_to_document[vid]
            for chunk_id in chunk_ids:
                parts = chunk_id.split("::")
                assert len(parts) == 3, f"{q.id}: bad chunk_id {chunk_id!r}"
                assert parts[0] == document_id, (
                    f"{q.id}: chunk {chunk_id!r} does not belong to {vid} ({document_id})"
                )
                assert parts[1].startswith("b") and parts[2].startswith("c")


def test_aspects_are_in_vocabulary(queries: list[EvalQuery]) -> None:
    # The enum enforces this at load time; assert explicitly as documentation.
    for q in queries:
        for aspect in q.relevant_aspects:
            assert isinstance(aspect, Aspect)


def test_unanswerable_queries_abstain_with_no_gold(queries: list[EvalQuery]) -> None:
    for q in queries:
        if q.query_type is QueryType.UNANSWERABLE:
            assert q.expected_decision is ExpectedDecision.ABSTAIN
            assert q.relevant_chunk_ids == {}


def test_follow_up_queries_carry_context(queries: list[EvalQuery]) -> None:
    for q in queries:
        if q.query_type is QueryType.FOLLOW_UP:
            assert q.context, f"{q.id}: follow_up query needs prior context"


def test_answerable_queries_have_gold_and_answer_points(queries: list[EvalQuery]) -> None:
    for q in queries:
        if q.query_type is not QueryType.UNANSWERABLE:
            assert q.relevant_chunk_ids, f"{q.id}: answerable query needs gold chunks"
            assert q.expected_answer_points, f"{q.id}: answerable query needs answer points"


@pytest.mark.skipif(not CHUNKS_DIR.is_dir(), reason="chunks not present (CI); local-only check")
def test_gold_chunk_ids_exist_on_disk(
    queries: list[EvalQuery], vehicle_to_document: dict[str, str]
) -> None:
    # Catches label typos: every gold chunk_id must be a real chunk in its document's JSONL.
    doc_chunk_ids: dict[str, set[str]] = {}
    for document_id in set(vehicle_to_document.values()):
        path = CHUNKS_DIR / f"{document_id}.jsonl"
        if not path.is_file():
            continue
        doc_chunk_ids[document_id] = {
            json.loads(line)["chunk_id"]
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        }

    for q in queries:
        for vid, chunk_ids in q.relevant_chunk_ids.items():
            document_id = vehicle_to_document[vid]
            available = doc_chunk_ids.get(document_id, set())
            for chunk_id in chunk_ids:
                assert chunk_id in available, f"{q.id}: gold chunk {chunk_id!r} not found on disk"
