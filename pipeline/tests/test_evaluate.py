"""Tests for retrieval metrics and the evaluation runner (offline, scripted retriever)."""

from __future__ import annotations

from car_talk_pipeline.evaluate import (
    balanced_coverage_hit,
    evaluate_dataset,
    expected_all_present,
    precision_at_k,
    recall_at_k,
    retrieval_text,
)
from car_talk_pipeline.models import EvalContextTurn, EvalQuery, ExpectedDecision, QueryType
from car_talk_pipeline.retrieval import RetrievalMode, RetrievedChunk


def _chunk(chunk_id: str, vehicle_id: str, score: float = 0.9) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=chunk_id,
        document_id=f"{vehicle_id}_review",
        vehicle_id=vehicle_id,
        score=score,
        section_heading="h",
        content_type="section",
        content="טקסט",
    )


# --- Pure metric helpers ------------------------------------------------------------


def test_recall_at_k() -> None:
    gold = {"a", "b"}
    assert recall_at_k(gold, [_chunk("a", "v")]) == 0.5
    assert recall_at_k(gold, [_chunk("a", "v"), _chunk("b", "v")]) == 1.0
    assert recall_at_k(gold, [_chunk("z", "v")]) == 0.0
    assert recall_at_k(set(), [_chunk("a", "v")]) == 0.0


def test_precision_at_k_scores_against_gold_chunks() -> None:
    retrieved = [_chunk("a", "mg_s6"), _chunk("b", "mg_s6"), _chunk("c", "other")]
    # Only "a" is a gold chunk → 1 of 5, even though 2 chunks are from the expected vehicle.
    assert precision_at_k({"a"}, retrieved, k=5) == 0.2
    assert precision_at_k(set(), retrieved, k=0) == 0.0


def test_expected_all_present() -> None:
    retrieved = [_chunk("a", "mg_s6"), _chunk("b", "aion_ht")]
    assert expected_all_present({"mg_s6", "aion_ht"}, retrieved) is True
    assert expected_all_present({"mg_s6", "genesis_gv80"}, retrieved) is False


def test_balanced_coverage_requires_a_gold_chunk_per_vehicle() -> None:
    retrieved = [_chunk("mg_gold", "mg_s6"), _chunk("aion_gold", "aion_ht")]
    assert (
        balanced_coverage_hit({"mg_s6": ["mg_gold"], "aion_ht": ["aion_gold"]}, retrieved) is True
    )
    # Aion appears, but not via its gold chunk → not covered.
    assert (
        balanced_coverage_hit({"mg_s6": ["mg_gold"], "aion_ht": ["aion_other"]}, retrieved) is False
    )


def test_retrieval_text_prepends_prior_user_turns() -> None:
    q = EvalQuery(
        id="q",
        query_type=QueryType.FOLLOW_UP,
        query="ומה הטווח שלו?",
        context=[
            EvalContextTurn(role="user", text="ספר לי על MG S6"),
            EvalContextTurn(role="assistant", text="בבקשה"),
        ],
        expected_decision=ExpectedDecision.INFORMATIONAL,
    )
    # Prior *user* turn is prepended; assistant turn is ignored.
    assert retrieval_text(q) == "ספר לי על MG S6 ומה הטווח שלו?"


# --- Runner -------------------------------------------------------------------------


class _ScriptedRetriever:
    collection = "car_review_chunks_v1"

    def __init__(self, script: dict[RetrievalMode, dict[str, list[RetrievedChunk]]]) -> None:
        self._script = script

    def search(
        self,
        query_text: str,
        mode: RetrievalMode,
        top_k: int = 5,
        vehicle_ids: list[str] | None = None,
    ) -> list[RetrievedChunk]:
        return self._script[mode].get(query_text, [])


def _single(qid: str, vid: str, gold: str) -> EvalQuery:
    return EvalQuery(
        id=qid,
        query_type=QueryType.SINGLE_VEHICLE,
        query=qid,
        expected_vehicle_ids=[vid],
        relevant_chunk_ids={vid: [gold]},
        expected_answer_points=["x"],
        expected_decision=ExpectedDecision.INFORMATIONAL,
    )


def _comparison(qid: str, gold: dict[str, list[str]]) -> EvalQuery:
    return EvalQuery(
        id=qid,
        query_type=QueryType.COMPARISON,
        query=qid,
        expected_vehicle_ids=list(gold),
        relevant_chunk_ids=gold,
        expected_answer_points=["x"],
        expected_decision=ExpectedDecision.TRADE_OFF,
    )


def _unanswerable(qid: str) -> EvalQuery:
    return EvalQuery(
        id=qid,
        query_type=QueryType.UNANSWERABLE,
        query=qid,
        expected_decision=ExpectedDecision.ABSTAIN,
    )


def test_evaluate_dataset_aggregates_and_accepts_hybrid() -> None:
    q1 = _single("q1", "mg_s6", "mg_s6_review::b0::c0")
    q2 = _comparison(
        "q2", {"mg_s6": ["mg_s6_review::b1::c1"], "aion_ht": ["aion_ht_review::b7::c0"]}
    )
    q3 = _unanswerable("q3")
    queries = [q1, q2, q3]

    mg1 = _chunk("mg_s6_review::b0::c0", "mg_s6")
    mg2 = _chunk("mg_s6_review::b1::c1", "mg_s6")
    aion = _chunk("aion_ht_review::b7::c0", "aion_ht")
    noise = _chunk("genesis_gv80_review::b0::c0", "genesis_gv80", score=0.2)

    # Hybrid recovers all gold; dense misses aion on q2 (recall 0.5, coverage fail); bm25 = dense.
    perfect = {"q1": [mg1], "q2": [mg2, aion], "q3": [noise]}
    weak = {"q1": [mg1], "q2": [mg2], "q3": [noise]}
    retriever = _ScriptedRetriever(
        {RetrievalMode.HYBRID: perfect, RetrievalMode.DENSE: weak, RetrievalMode.BM25: weak}
    )

    report = evaluate_dataset(queries, retriever, top_k=5)

    hybrid = report.mode_metrics[RetrievalMode.HYBRID]
    dense = report.mode_metrics[RetrievalMode.DENSE]
    assert hybrid.recall_at_5 == 1.0
    assert dense.recall_at_5 == 0.75  # (1.0 + 0.5) / 2
    assert hybrid.balanced_coverage == 1.0  # q2 both vehicles present
    assert dense.balanced_coverage == 0.0  # q2 missing aion

    accepted, _ = report.hybrid_accepted
    assert accepted is True

    # No hybrid failures (all gold recovered); unanswerable q3 reported with its top score.
    assert report.failures == []
    assert report.unanswerable_scores == [("q3", 0.2)]


def test_evaluate_dataset_flags_hybrid_failures() -> None:
    q1 = _single("q1", "mg_s6", "mg_s6_review::b0::c0")
    miss = {"q1": [_chunk("mg_s6_review::b9::c9", "mg_s6")]}  # wrong chunk → recall 0
    retriever = _ScriptedRetriever(
        {RetrievalMode.HYBRID: miss, RetrievalMode.DENSE: miss, RetrievalMode.BM25: miss}
    )
    report = evaluate_dataset([q1], retriever, top_k=5)
    assert len(report.failures) == 1
    assert report.failures[0].query_id == "q1"
    assert report.failures[0].recall == 0.0
