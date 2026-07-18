# Car-Talk — Progress

Progress tracker for the Car-Talk POC (evidence-first automotive review chatbot). Full
design: [`automotive_review_chatbot_spec.md`](automotive_review_chatbot_spec.md).

**How this works:** after each completed step, this file is updated and a PR is opened for
that step. One PR per task; only the owner merges.

Legend: ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked

_Last updated: 2026-07-18_

## Status by phase

| Phase | Status | Notes |
|---|---|---|
| Spike A — Scraping | ✅ | Merged in PR #1 |
| Spike B — Hybrid retrieval | ⬜ | Needs OpenAI + Qdrant keys |
| Spike C — Structured generation | ⬜ | Needs OpenAI key; verify model id first |
| Phase 2 — Full ingestion (8 articles) | ⬜ | Next up |
| Phase 3 — Chunking + embeddings + Qdrant | ⛔ | Blocked on OpenAI + Qdrant keys |
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

## Open flags / dependencies

- ⛔ **API keys not yet available**: OpenAI, Qdrant Cloud, Upstash — required from Phase 3 on.
- ⚠️ Verify the spec's model id `gpt-5.6-terra` + OpenAI Responses API against a live
  account **before** the generation phases.
- When building citations/generation: present FAQ Q&A as *publisher info* (`publisher_faq`),
  not as the reviewer's assessment.

## PR log

| PR | Task | Status |
|---|---|---|
| #1 | Ingestion foundation and Spike A scraping | Merged |
