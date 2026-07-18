# Car-Talk — Progress

Progress tracker for the Car-Talk POC (evidence-first automotive review chatbot). Full
design: [`automotive_review_chatbot_spec.md`](automotive_review_chatbot_spec.md).

**How this works:** after each completed step, this file is updated and a PR is opened for
that step. One PR per task; only the owner merges.

Legend: ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked

_Last updated: 2026-07-18 (Phase 5a: web bootstrap + vehicle resolver)_

## Status by phase

| Phase | Status | Notes |
|---|---|---|
| Spike A — Scraping | ✅ | Merged in PR #1 |
| Spike B — Hybrid retrieval | ✅ | Ablation run; hybrid kept (best resolution + coverage) |
| Spike C — Structured generation | ⬜ | Verify gpt-5.6-terra id first (OpenAI ready) |
| Phase 2 — Full ingestion (8 articles) | ✅ | All 8 extracted + validated; idempotent |
| Phase 3a — Chunking + embeddings | ✅ | 162 chunks embedded (1536-d); cache works |
| Phase 3b — Qdrant indexing | ✅ | 162 points in `car_review_chunks_v1` (dense + BM25) |
| Phase 4 — Evaluation dataset (30 Hebrew queries) | ✅ | Dataset + eval runner + ablation report; gates are a Phase-5 baseline |
| Phase 5 — Retrieval orchestrator | 🔄 | 5a: web bootstrap + vehicle resolver (100% on golden set); retrieval routes next |
| Phase 6 — Context + generation | ⬜ | |
| Phase 7 — Recommendation engine | ⬜ | |
| Phase 8 — Session memory | ⬜ | |
| Phase 9 — User interface (Next.js) | ⬜ | |
| Phase 10 — Security + reliability | ⬜ | |
| Phase 11 — Deployment (Vercel + Qdrant Cloud) | ⬜ | |

## ✅ Spike A — Scraping (PR #1, merged 2026-07-18)

Offline ingestion foundation and deterministic scraping of one article:

- `pipeline/` uv project: Ruff, mypy (strict), pytest, minimal GitHub Actions CI
- `data/sources.json`: manifest of 8 approved articles + canonical vehicle metadata
- `AutoCoIlAdapter`: deterministic HTML → canonical JSON (no LLM, no browser)
- Extracts publish/modify dates, FAQ Q&A (tagged `publisher_faq`), and pros/cons table
- Scrapy spider over HTTP, SHA-256 hashing, JSONL run manifest
- 29 tests + synthetic fixture; live-verified on MG S6, Lynk & Co, Aion HT
- ADR 0001: include tagged FAQ Q&A and pros/cons blocks

Structured-block coverage across the 8 articles: FAQ Q&A in 3/8, pros/cons in 2/8.

## ✅ Phase 2 — Full ingestion (8 articles)

All 8 approved articles scraped and validated end-to-end (no code changes needed — the
Spike A adapter handled every article):

- All 8 pass extraction acceptance (title, ≥1 section, ≥1,000 chars).
- Metadata correct per manifest; missing `model_year` stored as null (never guessed).
- Dates extracted for all 8 (all published Jan 2026). Q&A in 3/8, pros/cons in 2/8.
- Idempotent: re-running `--all` reports every doc `unchanged`, no duplicate files.
- Sections per article: 7–10, **except** `hyundai_elantra_n` and `kia_ev9`, which have
  **no HTML sub-headings** in the article body → each is a single `introduction` section.
  This is faithful (§6.5: deterministic, no guessing) and fine for chunking, which splits
  within a section by paragraph.
- Added a **synthetic** processed-document example: `docs/example_processed_document.json`
  (fabricated content, satisfies the repo's example-document requirement).

Note: raw HTML and full processed documents remain git-ignored (`.tmp/`); only the
synthetic example is committed.

## ✅ Phase 3a — Chunking + embeddings

Structure-aware chunker + dense embeddings (Qdrant indexing deferred to 3b):

- Chunker per the locked contract (soft 400 / pack 450 / hard 500, within-section, no
  overlap; oversized paragraphs split at sentence boundaries). Token counter is injected
  (`tiktoken` in production, a word counter in tests → offline CI).
- FAQ Q&A and pros/cons chunked as their own tagged synthetic sections
  (`content_type` = section/qa/pros_cons, `provenance` = publisher_faq for Q&A).
- Embedding: `text-embedding-3-small`, 1536-d, behind an `EmbeddingProvider` interface;
  batching, timeout, retry, response-dimension validation.
- On-disk embedding cache (`.tmp/embeddings/`) keyed by content hash + model version.
- **Live run:** 162 chunks across the 8 articles (147 section / 13 Q&A / 2 pros/cons),
  all ≤500 tokens (max 489), all 1536-d. Re-run embeds 0 (fully cached).
- OpenAI key loaded from git-ignored `.env` via `config.py`; never logged.
- Lean module layout for the POC: the pipeline is 8 flat modules under
  `car_talk_pipeline/` (`config`, `hashing`, `models`, `adapter`, `ingest`, `chunking`,
  `embedding`) — no thin one-purpose files, no interface/impl split for a single provider.

## ✅ Phase 3b — Qdrant indexing

Hybrid (dense + BM25) index of the Phase 3a chunks in one shared collection:

- New `qdrant_index.py` module + `car-talk-index` CLI (`--all` / `--document-id` /
  `--recreate`), mirroring the `car-talk-embed` shape. Reads chunks + cached dense vectors
  from `.tmp/` — **no re-embedding**; the client is injectable so tests run offline.
- Collection `car_review_chunks_v1` (locked contract, §8): named `dense` vector (1536-d,
  cosine) + named `bm25` sparse vector (server-side `qdrant/bm25`, IDF), RRF fusion at
  query time. Payload keyword indexes on `vehicle_id, document_id, vehicle_make,
  vehicle_model, article_type, coverage_scope`; integer index on `model_year`; full chunk
  text stored for grounding.
- Point id = deterministic UUIDv5 of `chunk_id` → idempotent upsert; replace-by-document
  deletes a document's points by `document_id` filter before re-inserting (§20.6). The whole
  collection is rebuildable from processed files (§8.6).
- **Live run:** 162 points across the 8 documents; re-run `--all` stays at 162 (no dupes).
  Hybrid query returns the right vehicle's chunks and a `document_id` filter narrows results.
  Dense query vectors are embedded client-side (OpenAI); only BM25 uses Qdrant inference.
- 9 offline tests (`_FakeQdrantClient`); CI stays live-Qdrant-free.

## 🔄 Phase 4 — Evaluation dataset (part A: golden set)

Manually-labeled Hebrew golden set of 30 queries (spec §18.1/§18.2), the prerequisite for
measuring retrieval quality. **This step is the dataset only**; the eval runner + metrics
(dense/BM25/hybrid ablation, Recall@5/Precision@5) is the next task (Phase 4b / Spike B).

- `data/eval_queries.json`: 30 queries — 10 single-vehicle, 8 comparison, 6 recommendation,
  3 unanswerable, 3 follow-up (§18.1). Each carries `expected_vehicle_ids`,
  `relevant_aspects` (from the §11.5 vocabulary), `relevant_chunk_ids` (real
  `{document_id}::b..::c..` ids), `expected_answer_points`, `expected_decision`, and
  `forbidden_claims`. Grounded in the live corpus — gold targets prefer the 13 Q&A / 2
  pros-cons chunks; unanswerable queries abstain with empty gold; follow-ups carry `context`.
- Schema (`Aspect`/`QueryType`/`ExpectedDecision` enums, `EvalQuery`, `load_eval_dataset`)
  added to `models.py`; ID scheme: `expected_vehicle_ids` + `relevant_chunk_ids` keys are
  `vehicle_id`, chunk-id values are real `chunk_id`s (validator maps via `sources.json`).
- 9 offline integrity tests (`test_eval_dataset.py`): distribution counts, id resolution,
  chunk-id shape, abstain/context invariants — plus a local-only check (skipped in CI) that
  every gold `chunk_id` exists on disk. All ~55 gold ids verified against `.tmp/chunks`.

## ✅ Phase 4b / Spike B — retrieval eval runner + ablation

Query-side retrieval + the evaluation that closes Phase 4's DoD (§18.3/§18.4):

- New `retrieval.py`: `HybridRetriever` (dense / BM25 / hybrid-RRF, optional `vehicle_id`
  filter), reusable by the Phase 5 orchestrator. Dense query vectors embedded client-side
  (OpenAI); BM25 server-side. Client + provider injectable → offline tests.
- New `evaluate.py` + `car-talk-eval` CLI: runs all 3 modes over the golden set, computes
  Recall@5 / Precision@5 / vehicle-resolution / balanced-coverage, applies the
  hybrid-acceptance rule, and writes `docs/eval_report.md` with the ablation table, gate
  pass/fail, failure cases, and interpretation. **All four metrics score against the labelled
  gold `chunk_id`s** (not vehicle membership) so a gate never passes on wrong-aspect evidence.
- 12 offline tests (metric helpers + scripted-retriever runner + fake-client query builders).

**Ablation result (live, top-5, approximate/HNSW ±a query or two):** hybrid R@5 ~0.60 · P@5
~0.22 · **hit-rate@5 ~0.82** · resolution ~0.86 · coverage ~0.10. Hybrid is **kept** by the
spec rule (beats dense-only), but **BM25-only is the strongest single mode** (R@5 0.65) — RRF
fusion with dense dilutes BM25's exact-term rankings on this Hebrew corpus (reconsider in
Phase 5). Spike B checks pass: exact term "178,888"→MG (BM25), vehicle filter works.

**Hit-rate@5 ~0.82** (≥1 gold chunk retrieved) is the answer-relevant read: a groundable
answer is available for ~82% of queries, far above strict Recall@5. The low recall/precision
is mostly labelling sparsity (1–3 gold tagged; sibling chunks carry the same fact), not
missing evidence — so answer quality is much better than the strict gates suggest.

**Finding (not a bug):** all four gates are **below the §18.3 targets** for *raw retrieval*.
Causes (in `docs/eval_report.md`): strict chunk-level gold (relevant *sibling* chunks in the
same section score 0 — resolution 0.86 shows the right vehicle is found), single-pool top-5
lets one vehicle dominate comparisons, and un-named recommendation queries need query→vehicle
resolution. All three are **Phase 5 orchestrator** work; per spec the gates are re-evaluated
there. RRF/top-k were **not** tuned to force a pass (spec line 567).

## 🔄 Phase 5a — web bootstrap + deterministic vehicle resolver

Per spec (§20.1) the retrieval orchestrator is **TypeScript in the Next.js app**, not Python.
Phase 5 is split: 5a bootstraps `web/` and delivers the deterministic resolver + shared
catalogs (offline-verifiable); 5b adds the live retrieval routes (Qdrant TS client, per-vehicle
balanced retrieval) — which is what actually lifts the coverage gate.

- **`web/`**: minimal Next.js 15 + TypeScript (strict) + Vitest, pnpm. No UI/API yet — only
  `web/lib/retrieval/`. `pnpm build` and `pnpm typecheck` pass.
- **Shared catalogs** (committed JSON in `data/`, language-agnostic, also usable by Python):
  `vehicle_catalog.json` (§11.2 — 8 vehicles with **Hebrew + English aliases**),
  `aspect_lexicon.json` (§11.5 — Hebrew/English keyword → the 11 aspect tokens).
- **Deterministic resolver** (§11.1, not LLM): `normalize` (NFKC + lowercase + punctuation),
  `matcher` (token-bounded, tolerant of attached **Hebrew one/two-letter prefixes** so "לאיון"
  → `aion_ht`, "הטווח" → `efficiency_range`), `vehicleResolver` (longest-match-first alias
  matching), `aspects` (keyword → aspect, max 3).
- **15 Vitest tests** incl. `vehicleResolution.eval.test.ts`: over the golden-set queries that
  **name** a vehicle, the resolver returns exactly `expected_vehicle_ids` → **vehicle resolution
  = 100%** (Phase 5 DoD); un-named recommendations + the out-of-corpus query resolve to no
  vehicle (→ discovery/abstain downstream).

## Open flags / dependencies

- ✅ **OpenAI key** available (in git-ignored `.env`).
- ✅ **Qdrant Cloud key** available; Phase 3b index is live. **Upstash keys** still absent
  (needed only for Phase 10 rate limiting, not retrieval).
- ⚠️ Verify the spec's model id `gpt-5.6-terra` + OpenAI Responses API against a live
  account **before** the generation phases.
- When building citations/generation: present FAQ Q&A as *publisher info* (`publisher_faq`),
  not as the reviewer's assessment.

## PR log

| PR | Task | Status |
|---|---|---|
| #1 | Ingestion foundation and Spike A scraping | Merged |
| #2 | PROGRESS.md progress tracker | Merged |
| #3 | Phase 2 — full ingestion of 8 articles | Merged |
| #4 | Phase 3a — chunking + embeddings (+ module consolidation 19→8) | Merged |
| #6 | Phase 3b — Qdrant hybrid indexing | Merged |
| #7 | Phase 4 — Hebrew golden eval dataset | Merged |
| #8 | Phase 4b / Spike B — retrieval eval runner + ablation | Merged |
| #9 | Phase 5a — web bootstrap + deterministic vehicle resolver | Open |
