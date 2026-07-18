# Retrieval evaluation report

Golden set: **30 queries** · collection `car_review_chunks_v1` · top-k = 5. Metric definitions: see `evaluate.py` docstring.

## Ablation — metrics by retrieval mode (spec §18.4)

| Mode | Recall@5 | Precision@5 | Vehicle resolution | Balanced coverage |
|---|---:|---:|---:|---:|
| dense | 0.552 | 0.185 | 0.655 | 0.000 |
| bm25 | 0.651 | 0.244 | 0.793 | 0.333 |
| hybrid | 0.611 | 0.222 | 0.862 | 0.167 |

## Release gates (hybrid vs §18.3 targets)

| Metric | Value | Target | Result |
|---|---:|---:|:--|
| Recall@5 | 0.611 | ≥ 0.85 | FAIL |
| Precision@5 | 0.222 | ≥ 0.7 | FAIL |
| Vehicle resolution | 0.862 | = 1.0 | FAIL |
| Balanced coverage | 0.167 | ≥ 0.9 | FAIL |

## Hybrid acceptance (spec line 565)

**KEEP hybrid** — ΔRecall@5=+0.059, ΔCoverage=+0.167 (improves=True, within 0.02 tolerance=True)

> Note: the strongest *single* mode is **bm25** on Recall@5 (0.651) and **bm25** on coverage (0.333) — both ≥ hybrid. RRF fusion with dense dilutes BM25's strong exact-term rankings on this Hebrew corpus. The acceptance rule only requires benefit over dense-only, but BM25-only is a live alternative to reconsider in the Phase 5 orchestrator.

## Failure cases (hybrid, recall < 1.0)

- **q12** (recall 0.00) — “למשפחה גדולה, מי מציע יותר מרחב, ג'נסיס GV80 או MG S6?”  
  expected vehicles: ['genesis_gv80', 'mg_s6']; gold: ['genesis_gv80_review::b4::c0', 'mg_s6_review::b5::c0', 'mg_s6_review::b6::c0']; top-5: ['genesis_gv80_review::b0::c0', 'mg_s6_review::b9::c2', 'mg_s6_review::b8::c0', 'lynk_co_01_review::b5::c4', 'mg_s6_review::b10::c3']
- **q13** (recall 0.00) — “מבחינת ביצועים ספורטיביים, אאודי RS3 או יונדאי אלנטרה N?”  
  expected vehicles: ['audi_rs3', 'hyundai_elantra_n_manual']; gold: ['audi_rs3_review::b1::c1', 'hyundai_elantra_n_review::b1::c0']; top-5: ['hyundai_elantra_n_review::b0::c15', 'audi_rs3_review::b1::c2', 'hyundai_elantra_n_review::b0::c13', 'hyundai_elantra_n_review::b0::c8', 'hyundai_elantra_n_review::b0::c1']
- **q16** (recall 0.00) — “איזו סביבת נהג ואיכות פנים טובה יותר, סיטרואן C3 או לינק אנד קו 01?”  
  expected vehicles: ['citroen_c3', 'lynk_co_01']; gold: ['citroen_c3_review::b3::c0', 'lynk_co_01_review::b4::c0', 'lynk_co_01_review::b7::c3']; top-5: ['citroen_c3_review::b5::c0', 'lynk_co_01_review::b4::c2', 'citroen_c3_review::b3::c4', 'citroen_c3_review::b1::c4', 'lynk_co_01_review::b4::c1']
- **q22** (recall 0.00) — “אני רוצה רכב עירוני קטן וזול לנהג/ת חדש/ה. מה כדאי?”  
  expected vehicles: ['citroen_c3']; gold: ['citroen_c3_review::b0::c0', 'citroen_c3_review::b1::c1']; top-5: ['lynk_co_01_review::b1::c1', 'hyundai_elantra_n_review::b1::c1', 'citroen_c3_review::b3::c3', 'hyundai_elantra_n_review::b1::c0', 'aion_ht_review::b7::c0']
- **q24** (recall 0.00) — “אני רוצה הוט-האצ' עם ביצועים גבוהים. מה מומלץ?”  
  expected vehicles: ['audi_rs3', 'hyundai_elantra_n_manual']; gold: ['audi_rs3_review::b1::c1', 'hyundai_elantra_n_review::b1::c0']; top-5: ['aion_ht_review::b6::c0', 'audi_rs3_review::b5::c6', 'aion_ht_review::b5::c0', 'lynk_co_01_review::b7::c1', 'audi_rs3_review::b5::c3']
- **q14** (recall 0.25) — “מי נותן תמורה טובה יותר למחיר ואבזור עשיר, לינק אנד קו 01 או MG S6?”  
  expected vehicles: ['lynk_co_01', 'mg_s6']; gold: ['lynk_co_01_review::b7::c0', 'lynk_co_01_review::b8::c0', 'mg_s6_review::b10::c0', 'mg_s6_review::b11::c0']; top-5: ['mg_s6_review::b11::c0', 'mg_s6_review::b9::c2', 'lynk_co_01_review::b7::c3', 'mg_s6_review::b10::c3', 'lynk_co_01_review::b5::c4']
- **q19** (recall 0.25) — “אני מחפש SUV חשמלי משפחתי עם טווח טוב וטעינה מהירה. מה מומלץ?”  
  expected vehicles: ['mg_s6', 'aion_ht']; gold: ['aion_ht_review::b2::c1', 'aion_ht_review::b7::c0', 'mg_s6_review::b10::c0', 'mg_s6_review::b6::c1']; top-5: ['mg_s6_review::b10::c3', 'mg_s6_review::b10::c0', 'mg_s6_review::b9::c2', 'audi_rs3_review::b5::c3', 'lynk_co_01_review::b8::c0']
- **q06** (recall 0.50) — “האם לינק אנד קו 01 תומך בטעינה מהירה DC?”  
  expected vehicles: ['lynk_co_01']; gold: ['lynk_co_01_review::b7::c1', 'lynk_co_01_review::b8::c0']; top-5: ['lynk_co_01_review::b7::c1', 'lynk_co_01_review::b7::c0', 'lynk_co_01_review::b5::c4', 'lynk_co_01_review::b2::c3', 'lynk_co_01_review::b7::c3']
- **q11** (recall 0.50) — “מה עדיף מבחינת טווח וטעינה, MG S6 או איון HT?”  
  expected vehicles: ['mg_s6', 'aion_ht']; gold: ['aion_ht_review::b2::c1', 'aion_ht_review::b7::c0', 'mg_s6_review::b10::c0', 'mg_s6_review::b6::c1']; top-5: ['mg_s6_review::b9::c2', 'mg_s6_review::b10::c0', 'mg_s6_review::b10::c3', 'aion_ht_review::b2::c1', 'mg_s6_review::b9::c3']
- **q17** (recall 0.50) — “מבחינת התנהגות כביש, ג'נסיס GV80 או אאודי RS3?”  
  expected vehicles: ['genesis_gv80', 'audi_rs3']; gold: ['audi_rs3_review::b6::c0', 'genesis_gv80_review::b6::c0']; top-5: ['audi_rs3_review::b0::c1', 'genesis_gv80_review::b6::c1', 'genesis_gv80_review::b0::c0', 'genesis_gv80_review::b6::c0', 'audi_rs3_review::b1::c2']
- **q18** (recall 0.50) — “מבחינת מערכות בטיחות, קיה EV9 או איון HT?”  
  expected vehicles: ['kia_ev9', 'aion_ht']; gold: ['aion_ht_review::b1::c1', 'kia_ev9_long_term_report::b0::c3']; top-5: ['kia_ev9_long_term_report::b0::c1', 'kia_ev9_long_term_report::b0::c3', 'kia_ev9_long_term_report::b0::c5', 'kia_ev9_long_term_report::b0::c0', 'kia_ev9_long_term_report::b0::c7']
- **q20** (recall 0.50) — “אני חובב נהיגה שרוצה מכונית ספורט אמיתית עם תיבה ידנית. מה מתאים?”  
  expected vehicles: ['hyundai_elantra_n_manual']; gold: ['hyundai_elantra_n_review::b1::c0', 'hyundai_elantra_n_review::b1::c2']; top-5: ['hyundai_elantra_n_review::b1::c4', 'audi_rs3_review::b5::c5', 'audi_rs3_review::b6::c1', 'hyundai_elantra_n_review::b1::c0', 'audi_rs3_review::b3::c0']
- **q21** (recall 0.50) — “אני צריך SUV יוקרתי עם שלוש שורות ישיבה למשפחה גדולה. מה מומלץ?”  
  expected vehicles: ['genesis_gv80']; gold: ['genesis_gv80_review::b1::c0', 'genesis_gv80_review::b4::c0']; top-5: ['audi_rs3_review::b5::c6', 'genesis_gv80_review::b1::c0', 'kia_ev9_long_term_report::b0::c3', 'genesis_gv80_review::b1::c1', 'mg_s6_review::b8::c0']
- **q23** (recall 0.50) — “אני מחפש רכב פנאי משפחתי עם תמורה גבוהה למחיר ואבזור עשיר. מה מומלץ?”  
  expected vehicles: ['mg_s6', 'lynk_co_01']; gold: ['lynk_co_01_review::b8::c0', 'mg_s6_review::b11::c0']; top-5: ['mg_s6_review::b10::c3', 'mg_s6_review::b11::c0', 'audi_rs3_review::b6::c1', 'kia_ev9_long_term_report::b0::c6', 'mg_s6_review::b9::c1']
- **q30** (recall 0.50) — “ואיזה מהם נטען מהר יותר ב-DC?”  
  expected vehicles: ['mg_s6', 'aion_ht']; gold: ['aion_ht_review::b2::c1', 'mg_s6_review::b10::c0']; top-5: ['mg_s6_review::b7::c1', 'aion_ht_review::b1::c0', 'mg_s6_review::b10::c1', 'mg_s6_review::b1::c1', 'mg_s6_review::b10::c0']

## Interpretation

Hybrid vehicle resolution (0.86) is far higher than chunk-level Recall@5 (0.61) and Precision@5 (0.22): retrieval usually surfaces the **right vehicle**, just not always the exact labelled gold chunk. Recurring structural causes (see failure cases):

- **Strict chunk-level gold.** Sibling chunks from the *same section* as the gold (e.g. q13 returns `audi_rs3_review::b1::c2` next to gold `::b1::c1`) are relevant but score 0 — Recall@5 understates real quality. This is a labelling-sparsity artefact, not a retrieval fault, and is not fixed by tuning RRF/top-k (spec forbids).
- **Comparison coverage.** A single top-5 pool lets one vehicle dominate (e.g. q18 fills all 5 slots with Kia), so the other compared vehicle can't contribute — this caps balanced coverage. Fix: per-vehicle retrieval then merge (Phase 5 orchestrator).
- **Un-named recommendation queries.** Queries that describe a need without naming a vehicle (q22, q24) scatter across the corpus — they need a query→vehicle resolution step (Phase 5), absent from this raw-retrieval baseline.

These are baseline numbers for **raw retrieval only**; the §18.3 gates are evaluated against the full retrieval orchestrator (Phase 5), which adds vehicle resolution and per-vehicle evidence gathering. Hybrid beats dense-only (the spec's acceptance reference), but note above that BM25-only is the strongest single mode here.

_Qdrant uses approximate (HNSW) search, so metrics may vary by a query or two between runs; this report is a representative snapshot, not an exact fixed value._

## Unanswerable queries — hybrid top-1 score (for abstention design)

- q25: 0.8333
- q26: 0.6667
- q27: 0.5714
