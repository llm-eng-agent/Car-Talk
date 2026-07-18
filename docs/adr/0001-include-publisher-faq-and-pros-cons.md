# ADR 0001: Include the publisher FAQ (Q&A) and pros/cons verdict table as tagged blocks

- **Status:** Accepted
- **Date:** 2026-07-18
- **Context spec:** `automotive_review_chatbot_spec.md` (locked). This ADR is the explicit
  ADR update its decision rule requires when deviating from a locked value.

## Context

Some Auto.co.il review articles contain two structured blocks that sit **outside** the
article prose containers (`div.article-rte-section`) and were therefore excluded by the
initial Spike A extraction:

1. **FAQ Q&A accordion** (`.faq__body .spollers__item`) — factual Q&A: price, real-world
   range, charging time, power, dimensions, safety (NCAP), warranty.
2. **Pros/cons verdict table** (`.pros-cons-table`) — the reviewer's concise
   strengths/weaknesses summary. Distinct from both the "הרכב הנבחן" prose section and
   the competitor spec-comparison table (`vehicle-table`).

Coverage verified live across all 8 approved articles:

| Block | Articles with it |
|---|---|
| FAQ Q&A | 3/8 — MG S6, Hyundai Elantra N, Lynk & Co (≈10 pairs each) |
| Pros/cons table | 2/8 — Lynk & Co (6/5), MG S6 (4/3) |

## Decision

Extract **both** blocks and store them on `CanonicalDocument` as **separate, provenance-
tagged structures** (not merged into the prose sections):

- `qa_pairs: list[QAPair]` — each tagged `source = publisher_faq`.
- `pros_cons: ProsCons | None` — the reviewer's pros/cons lists.

Both are best-effort: empty list / `None` when the article lacks them; their absence does
not fail extraction acceptance. Both are substantive evidence and are included in the
normalized content hash.

## Why this deviates from the locked spec

The locked spec (§5.6 + Locked Contract) excludes "existing AI-generated summaries" and
tables, and the extracted content is defined as title/introduction/headings/paragraphs.
The product owner requested these blocks for their evidence value. Keeping them as
**separate tagged blocks** (rather than inline prose) preserves the core principle
"distinguish reviewer opinion from objective claims".

## Provenance and managed risk

- **Pros/cons** is the reviewer's own verdict → high trust; treat as reviewer assessment.
- **FAQ Q&A** may be AI-assisted (no explicit marker on the page). It is tagged
  `publisher_faq` so downstream retrieval/citation can present it as *publisher FAQ*, not
  as the reviewer's assessment. Follow-up when building generation/citations: surface the
  FAQ provenance in source cards and avoid attributing FAQ claims to the reviewer.
- The competitor spec-comparison table (`vehicle-table`) remains **excluded**.

## Consequences

- Extends the locked canonical schema (§6.2) with `qa_pairs` and `pros_cons`.
- The normalized content hash of articles that have these blocks changes (new content) —
  a one-time, intended re-index signal.
- No change to extraction acceptance rules.
