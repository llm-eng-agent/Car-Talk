# Car-Talk — Progress

Progress tracker for the Car-Talk POC (evidence-first automotive review chatbot). Full
design: [`automotive_review_chatbot_spec.md`](automotive_review_chatbot_spec.md).

**How this works:** after each completed step, this file is updated and a PR is opened for
that step. One PR per task; only the owner merges.

Legend: ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked

_Last updated: 2026-07-18 (Phase 3a merged)_

## Status by phase

| Phase | Status | Notes |
|---|---|---|
| Spike A — Scraping | ✅ | Merged in PR #1 |
| Spike B — Hybrid retrieval | ⬜ | Needs Qdrant key (OpenAI ready) |
| Spike C — Structured generation | ⬜ | Verify gpt-5.6-terra id first (OpenAI ready) |
| Phase 2 — Full ingestion (8 articles) | ✅ | All 8 extracted + validated; idempotent |
| Phase 3a — Chunking + embeddings | ✅ | 162 chunks embedded (1536-d); cache works |
| Phase 3b — Qdrant indexing | ⛔ | Blocked on Qdrant key |
| Phase 4 — Evaluation dataset (30 Hebrew queries) | ⬜ | |
| Phase 5 — Retrieval orchestrator | ⬜ | |
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

## Open flags / dependencies

- ✅ **OpenAI key** available (in git-ignored `.env`).
- ⛔ **Qdrant Cloud + Upstash keys** not yet available — Qdrant needed for Phase 3b indexing.
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
