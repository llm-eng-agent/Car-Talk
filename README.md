# Car-Talk

An evidence-first conversational car advisor: a proof-of-concept chatbot that helps users
understand, compare, and choose cars based **exclusively** on real automotive review
articles from Auto.co.il.

See [`automotive_review_chatbot_spec.md`](automotive_review_chatbot_spec.md) for the full
locked specification.

## Repository layout

```
data/sources.json   Curated manifest: 8 approved articles + canonical vehicle metadata
pipeline/           Offline Python pipeline (scrape → process → chunk → embed → index → eval)
web/                Next.js app on Vercel (added in a later phase)
```

The pipeline scripts follow a WAT-style split: deterministic tools under
`pipeline/src/...` and plain-language SOPs under `pipeline/workflows/`.

## Current status

**Phase: Spike A — scraping** (see the spec's implementation plan). Implemented so far:

- Source manifest (`data/sources.json`) with canonical vehicle identity for all 8 articles.
- Deterministic `AutoCoIlAdapter` extraction (HTML → canonical JSON document), no LLM,
  no browser.
- Extraction acceptance tests (the binding contract).
- Scrapy spider over normal HTTP, SHA-256 hashing, and a JSONL run manifest.

## Getting started (pipeline)

```bash
cd pipeline
uv sync
uv run pytest            # runs offline against fixtures — no API keys needed
uv run car-talk-scrape --document-id mg_s6   # scrape one article live
```

See [`pipeline/README.md`](pipeline/README.md) and
[`pipeline/workflows/scrape_article.md`](pipeline/workflows/scrape_article.md) for details.

## Configuration

Copy [`.env.example`](.env.example) to `.env` and fill in values as later phases require
them. Spike A scraping needs no secrets.
