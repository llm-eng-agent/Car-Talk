# Car-Talk pipeline

Offline Python ingestion pipeline for the Car-Talk automotive review chatbot POC:
scraping → deterministic extraction → (later) chunking, embedding, indexing, evaluation.

See the repository root `README.md` and `automotive_review_chatbot_spec.md` for the full design.

## Requirements

- Python 3.12
- [uv](https://docs.astral.sh/uv/)

## Setup

```bash
uv sync
```

## Commands

```bash
uv run ruff check .      # lint
uv run ruff format .     # format
uv run mypy .            # type check
uv run pytest            # tests
```

## Scraping (Spike A)

```bash
# Scrape a single article by document_id from data/sources.json
uv run car-talk-scrape --document-id mg_s6

# Scrape all enabled sources
uv run car-talk-scrape --all
```

Canonical documents are written to `.tmp/processed/` and raw HTML to `.tmp/raw/`
(both git-ignored). A JSONL run manifest is written to `.tmp/run_manifest.jsonl`.
