# Workflow: Scrape an Auto.co.il review article

SOP for turning an approved article URL into a canonical JSON document. Deterministic,
no LLM, no browser (spec sections 5–6).

## Objective

Produce one canonical document per article: title + introduction + heading-based sections
of ordered paragraphs, excluding all non-article content.

## Inputs

- `data/sources.json` — the curated source manifest (URLs + canonical vehicle metadata).
  Vehicle identity is authored here, never guessed from prose.

## Tools

- `car-talk-scrape` CLI (`src/car_talk_pipeline/ingest.py`)
- extraction in `src/car_talk_pipeline/adapter.py` — owns the CSS selectors.

## Steps

1. Ensure the target article is present and `enabled` in `data/sources.json`.
2. Run one article first:
   ```bash
   cd pipeline
   uv run car-talk-scrape --document-id <document_id>
   ```
3. Inspect outputs under `.tmp/` (git-ignored):
   - `.tmp/raw/<document_id>.html` — raw HTML (debug only, untrusted, never indexed).
   - `.tmp/processed/<document_id>.json` — canonical document.
   - `.tmp/run_manifest.jsonl` — status, hashes, char/section counts, errors.
4. Verify the run record `status` (`created` / `unchanged` / `updated` / `failed`).

## Expected output

A canonical document that satisfies the extraction acceptance rules (the binding
contract, enforced by `tests/test_adapter.py`):

- non-empty article title
- at least one content section
- at least 1,000 normalized content characters
- no navigation, comments, images, ads, related content, or existing AI/FAQ summary
- deterministic: same HTML → identical output

## Edge cases

- **Extraction fails acceptance** → the adapter raises `ExtractionError`; a `failed` run
  record is written. Fix the selectors in `adapter.py` — do **not** introduce a
  browser to mask incorrect extraction (spec 5.3).
- **Non-200 / network error** → an error run record is written via the spider errback.
- **robots.txt disallows** → revisit politeness settings in `AutoCoIlSpider.custom_settings`
  and confirm the source is on the approved allowlist before proceeding.

## Structured supplementary blocks (optional, per `docs/adr/0001`)

Two blocks that live outside `article-rte-section` are extracted separately and tagged,
not merged into the prose:

- **FAQ Q&A** (`.faq__body .spollers__item`) → `qa_pairs[]`, tagged `publisher_faq`
  (may be AI-assisted; keep the distinction in citations). Present in 3/8 articles.
- **Pros/cons verdict table** (`.pros-cons-table`) → `pros_cons` (reviewer assessment),
  columns mapped by title (יתרונות/חסרונות). Present in 2/8 articles.

Both are best-effort (empty/None when absent) and are included in the content hash. The
separate competitor spec-comparison table (`vehicle-table`) stays **excluded**.

## Notes / learnings

- Article prose is confined to `div.article-rte-section` blocks; galleries, the competitor
  comparison table, and comments live in other containers and are excluded by scoping
  prose extraction to those blocks.
- Auto.co.il serves article content over normal HTTP (server-rendered Umbraco CMS), so no
  browser rendering is needed.
- Publication/modification dates come from JSON-LD (`datePublished`/`dateModified`), with
  the `<time class="article-meta__date">` element as a published-only fallback.
