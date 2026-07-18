# Car-Talk 🚗

**An evidence-first Hebrew car-advisor chatbot** — it helps users understand, compare, and
choose cars, answering **exclusively** from real automotive review articles on
[Auto.co.il](https://www.auto.co.il). If a question can't be grounded in that corpus, the bot
says so (and names the vehicle) instead of guessing.

![Car-Talk homepage](.github/assets/home.png)

## What it is

Car-Talk is a proof-of-concept conversational advisor. Every answer is built from the text of
eight approved review articles — never from the model's own world knowledge. When a user asks
about a car outside the corpus, or the evidence is too thin, the bot gives a graceful,
witty abstention rather than a hallucinated answer.

## Features

- **Single-vehicle Q&A** — ask about one reviewed car and get an evidence-backed summary.
- **Model comparison** — compare two reviewed cars across aspects (e.g. EV9 vs. GV80).
- **Discovery & recommendations** — describe a need (family, budget, electric) and get a
  deterministic recommendation with the trade-offs spelled out.
- **Inline citations** — every claim links to the exact source excerpt it came from.
- **Session memory** — the bot carries context across turns in a conversation.
- **Honest abstention** — out-of-corpus or low-evidence questions get a clear "not in my
  review corpus" reply instead of a made-up answer.

## The reviewed cars (8)

Citroen C3 · Audi RS3 · Kia EV9 · MG S6 · Hyundai Elantra N · Aion HT · Lynk & Co 01 ·
Genesis GV80

Canonical identities and aliases live in
[`data/vehicle_catalog.json`](data/vehicle_catalog.json); the source manifest is
[`data/sources.json`](data/sources.json).

## How it works

```
user query
   │
   ▼
retrieval (Qdrant hybrid search)  ──►  evidence package
   │                                       │
   │                          out-of-scope / insufficient?  ──►  short-circuit (no LLM call)
   ▼                                       │
context builder + citation map            └─►  graceful abstention
   │
   ▼
structured LLM generation  ──►  validated answer + citations
   │
   ▼
deterministic recommendation engine (for discovery queries)
```

Retrieval narrows the eight-article corpus to the relevant chunks, generation is constrained
to that evidence, and the output is schema-validated before it reaches the UI. Terminal
statuses (out-of-scope, insufficient evidence) never spend a generation call.

## Tech stack

- **Web** — Next.js 15, React 19, Tailwind CSS 4 (deployed on Vercel).
- **LLM** — OpenAI for embeddings and structured generation.
- **Vector search** — Qdrant (hybrid indexing).
- **Rate limiting** — Upstash Redis.
- **Pipeline** — offline Python (managed with `uv`): scrape → process → chunk → embed →
  index → evaluate.

## Repository layout

```
data/        Curated corpus: sources, vehicle catalog, aspect lexicon, eval queries
pipeline/    Offline Python pipeline (scrape → process → chunk → embed → index → eval)
web/         Next.js chat app (retrieval, generation, session, UI)
docs/        Eval report and example processed document
```

## Getting started

### Pipeline (offline)

```bash
cd pipeline
uv sync
uv run pytest            # runs offline against fixtures — no API keys needed
```

See [`pipeline/README.md`](pipeline/README.md) for the scraping and indexing workflow.

### Web app

```bash
cd web
npm install
npm run dev              # http://localhost:3000
npm test                 # unit tests (vitest)
npm run test:e2e         # end-to-end tests (playwright)
```

## Configuration

Set these in a `.env` file (or your environment). The web app expects:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Embeddings + structured generation |
| `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` | Vector search |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting store |
| `RATE_LIMIT_SECRET` | Required in deployed environments |

The offline pipeline tests need no secrets.

## Status

Proof of concept — the full pipeline and chat app are implemented.
