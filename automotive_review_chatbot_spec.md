# Automotive Review Chatbot
## Locked Product Requirements, Technical Design, Architecture Decisions, and Implementation Plan

**Specification version:** 1.0 Locked

**Decision rule:** Any change to a locked value requires an explicit ADR update and a documented failed release gate or new requirement.


## Authoritative Final Decision Snapshot

This section is the source of truth for the decisions that were finalized during the architecture discussion. Earlier alternatives documented later in this file are included only to explain trade-offs.

| Layer | Final decision |
|---|---|
| Product | Evidence-first conversational car advisor |
| Data scope | Only the eight supplied Auto.co.il review articles |
| Scraping | Scrapy over normal HTTP |
| Browser rendering | Not included in the POC. The eight approved sources must be ingested through Scrapy over normal HTTP |
| Extracted content | Textual article content only: title, introduction, section headings, and paragraphs; no images, comments, navigation, ads, or existing AI summaries |
| Canonical storage format | Structured JSON or JSONL, not Markdown |
| Document boundary | One article equals one document |
| Internal document structure | Sections defined by article headings, containing ordered paragraphs |
| LLM during ingestion | None |
| Chunking | Structure-aware grouping of consecutive paragraphs within a section, approximately 350 to 500 tokens, no fixed overlap |
| Vector database | Qdrant Cloud |
| Collection strategy | One shared versioned collection for all vehicle-review chunks |
| Retrieval | Hybrid dense and BM25 sparse retrieval |
| Fusion | Reciprocal Rank Fusion |
| Dense similarity | Cosine |
| Embedding model | OpenAI `text-embedding-3-small` |
| Embedding dimensions | 1,536 |
| Sparse representation | Qdrant server-side `qdrant/bm25` inference for both offline indexing and online queries |
| Neural reranker | Not included in the POC |
| Vehicle resolution | Deterministic alias-to-`vehicle_id` mapping |
| Comparison retrieval | Separate, balanced retrieval per vehicle |
| Open recommendation retrieval | Global candidate discovery followed by balanced evidence retrieval for the top three candidates |
| Query rewriting with an LLM | Not included |
| Language model | OpenAI `gpt-5.6-terra` |
| Generation API | OpenAI Responses API |
| Reasoning effort | Low |
| LLM tools | None |
| Generation calls | One successful structured generation call per user message |
| Output format | Strict JSON Schema structured output |
| Streaming | Processing-stage events; the final answer is displayed only after validation |
| Sources | Citation IDs returned by the model and resolved deterministically to article title, section, excerpt, and URL |
| Recommendation | Constraint-first deterministic logic, then lexicographic priorities, then Pareto dominance |
| Numerical vehicle scores | Not used |
| Conversation memory | Session-scoped short-term memory only |
| Long-term memory | None |
| Chat persistence | None |
| UI | Customized Vercel AI Chatbot Template |
| Online deployment | One Next.js application on Vercel |
| Separate FastAPI or Render service | None |
| Offline processing | Python pipeline for scraping, processing, chunking, indexing, and evaluation |
| Evaluation | Manually labeled Hebrew golden set of 30 queries |
| Paid services | OpenAI embeddings and OpenAI language-model generation |
| Target free services | Vercel hosting and Qdrant Cloud where free-tier limits are sufficient |

### Explicitly Not Selected

- Gemini embeddings were considered but were not selected.
- IBM Granite embeddings were considered but were not selected because self-hosted inference would add a separate runtime, cold starts, and operational complexity.
- `text-embedding-3-large` was considered but was not selected for the initial POC.
- Streamlit, Gradio, Chainlit, assistant-ui as a from-scratch base, and Open WebUI were not selected.
- FastAPI on Render was considered and then removed from the final online architecture.
- Crawl4AI and browser-first scraping were not selected.
- A neural reranker, LLM query planner, agent framework, and long-term memory were not selected.

### Locked Implementation Contract

The following values are fixed for POC version 1.0. They may change only if a defined release gate fails. They are not left for ad hoc tuning during implementation.

#### Source ingestion

- The POC uses Scrapy over normal HTTP only.
- Playwright, Crawl4AI, and browser rendering are not included.
- A source that cannot be extracted over HTTP fails the ingestion spike and must be fixed in `AutoCoIlAdapter`.
- The eight approved URLs and their canonical vehicle metadata are stored in `data/sources.json`.
- Canonical vehicle identity is curated in the manifest rather than guessed from article prose.
- Each manifest entry includes:
  - `document_id`
  - `vehicle_id`
  - `canonical_name`
  - `make`
  - `model`
  - `model_year`
  - `article_type`
  - `coverage_scope`
  - `url`
- `article_type` is one of `road_test` or `long_term_report`.
- `coverage_scope` is one of `full_review` or `partial_update`.
- The Kia EV9 long-term article is marked as `long_term_report` and `partial_update`.
- Extraction acceptance requires:
  - HTTP status 200
  - A non-empty article title
  - At least one content section
  - At least 1,000 normalized content characters
  - No navigation, comments, image elements, advertisements, related-content blocks, or existing AI summaries
- The source adapter owns the exact CSS or XPath selectors. Selector spelling is an implementation detail, while the extraction acceptance tests are the binding contract.
- Raw HTML and normalized article text receive separate SHA-256 hashes.
- Idempotency is based on `normalized_content_hash` plus `pipeline_version`.
- No ingestion registry database is used. A local JSONL run manifest records document status, hashes, timestamps, and errors.

#### Chunking

- Soft target: 400 tokens.
- Packing target: up to 450 tokens using complete consecutive paragraphs.
- Hard maximum: 500 tokens.
- A section at or below 500 tokens becomes one chunk.
- A section above 500 tokens is greedily packed by complete paragraph.
- A single paragraph above 500 tokens is split only at sentence boundaries.
- Chunks never cross section boundaries.
- Fixed overlap is zero.
- Token counting uses `tiktoken` with the encoding selected for the OpenAI embedding model.
- Embedding text format is:

```text
רכב: {canonical_vehicle_name}
כתבה: {article_title}
נושא: {section_heading}

{chunk_content}
```

#### Qdrant collection

```text
Collection: car_review_chunks_v1

Named dense vector:
  name: dense
  size: 1536
  distance: cosine

Named sparse vector:
  name: bm25
  model: qdrant/bm25

Fusion:
  reciprocal rank fusion
  equal contribution from dense and sparse rankings
```

- Qdrant server-side `qdrant/bm25` inference is used during both Python indexing and TypeScript querying.
- No custom Hebrew BM25 tokenizer is implemented in the POC.
- No sparse vectors are manually generated in two programming languages.
- Payload indexes:
  - keyword: `vehicle_id`
  - keyword: `document_id`
  - keyword: `vehicle_make`
  - keyword: `vehicle_model`
  - keyword: `article_type`
  - keyword: `coverage_scope`
  - integer: `model_year`
- The full chunk text is stored in payload for grounding and citation display.
- RRF weights are not tuned on the 30-query evaluation set. Dense and sparse rankings contribute equally.

#### Retrieval defaults

- Dense prefetch: 20 candidates.
- BM25 prefetch: 20 candidates.
- Single-vehicle answer: final top 5 chunks.
- Direct comparison: independent parallel retrieval per vehicle, final top 3 chunks per vehicle.
- Direct comparison limit: 4 vehicles.
- Open recommendation:
  - group discovery results by `vehicle_id`
  - select 3 candidate vehicle groups
  - retain up to 2 discovery chunks per group
  - run a second evidence search for each selected vehicle
  - retain final top 3 evidence chunks per vehicle
- No fixed RRF score threshold is used because fused rank scores are not calibrated relevance probabilities.
- The application does not treat the lowest returned result as relevant automatically. Evidence sufficiency is verified through:
  - required vehicle coverage
  - required aspect coverage
  - structured model assessment
  - deterministic recommendation validation
- The POC does not tune RRF weights, dense weights, or per-route Top-K values unless an evaluation release gate fails.

#### Vehicle and aspect resolution

- Vehicle matching is deterministic.
- Input normalization includes Unicode NFKC normalization, Latin lowercase conversion, whitespace normalization, and hyphen and punctuation normalization.
- Alias matching uses longest-match-first.
- Fuzzy matching is not used.
- An unresolved or ambiguous vehicle mention produces `clarification_required`.
- Approved comparison aspects:

```text
ride_comfort
space_practicality
performance
handling
interior_quality
usability_ergonomics
efficiency_range
refinement
value_for_money
safety_equipment
design
```

- Hebrew and English keyword aliases map user wording to the approved aspect vocabulary.
- At most 3 explicitly requested or prioritized aspects are evaluated in one answer.
- If more than 3 priorities are provided, the first 3 in the user's stated order are used and the scope is disclosed.
- A single-vehicle question with no explicit aspect uses a general review query covering conclusion, strengths, and weaknesses.
- An open request such as “which car is best?” with no preference, constraint, usage pattern, or active vehicle returns one clarification question before retrieval.
- Open recommendation requires at least one recognized preference, hard constraint, or usage pattern.

#### Hard constraints and usage patterns

Supported hard constraints:

```text
minimum_seats
allowed_powertrains
transmission
```

Allowed powertrains:

```text
electric
hybrid
gasoline
diesel
```

Allowed transmission values:

```text
automatic
manual
```

Supported usage patterns:

```text
city_driving
highway_driving
long_trips
family_with_children
sporty_driving
```

- Hard constraints are accepted only when explicitly stated.
- Seat count, powertrain, and transmission are parsed deterministically before retrieval.
- Budget is not enforced as a hard constraint in POC version 1.0 because article prices may be historical, dynamic, or version-specific.
- If a user provides a budget, the chatbot explains that it cannot verify current price compliance from the supplied review corpus.
- An inferred preference is stored only after the same aspect appears in at least two different user turns.
- Hard constraints are never inferred.
- The session state stores per-aspect mention counters to enforce the two-turn rule.

#### Session state

- Session memory is stored in browser `sessionStorage`.
- It survives a page refresh in the same tab.
- It is cleared when the tab session ends.
- `New Conversation` clears the state immediately and creates a new UUID session ID.
- `localStorage` is not used.
- No conversation state is written to a database.
- No conversation state is stored in Qdrant.
- Upstash is used only for rate-limit counters, never for conversational memory.
- The server accepts at most the two most recent conversation turns.

#### OpenAI model usage

```text
Embedding model: text-embedding-3-small
Embedding dimensions: 1536
Dense distance: cosine

Language model: gpt-5.6-terra
API: OpenAI Responses API
Reasoning effort: low
Tools: none
Web search: disabled
File search: disabled
Maximum output tokens: 1200
Normal successful generation calls per message: 1
```

- The application uses the direct OpenAI provider through `@ai-sdk/openai`.
- Vercel AI Gateway is not used.
- The same server-side `OPENAI_API_KEY` is used for embeddings and generation in the POC.
- The application does not set a temperature for `gpt-5.6-terra`.
- A second generation call is permitted only as one retry for a transient provider error, invalid schema, incomplete response, or invalid citation reference.

#### Structured generation schema

The single model call returns:

```text
status:
  complete
  partial
  insufficient_evidence
  out_of_scope

mode:
  single_vehicle
  comparison
  recommendation

overview:
  text
  citation_ids[]

aspect_assessments[]:
  aspect
  assessment
  winner_vehicle_id
  explanation
  citation_ids[]

constraint_assessments[]:
  constraint
  vehicle_id
  status
  explanation
  citation_ids[]

missing_information[]

preference_updates[]:
  aspect
  priority
  source
  evidence_text

usage_pattern_updates[]:
  usage_pattern
  source
  evidence_text

follow_up_question
```

Allowed aspect assessment values:

```text
positive
negative
mixed
vehicle_advantage
tie
trade_off
insufficient_evidence
```

Allowed constraint assessment values:

```text
satisfied
not_satisfied
partially_satisfied
insufficient_evidence
```

- `winner_vehicle_id` is nullable.
- The schema contains no `recommended_vehicle_id`.
- The language model never selects the final recommended vehicle.
- Every non-empty `overview` and `aspect_assessment` requires one or more valid citation IDs.
- `evidence_text` for a preference or usage update must be an exact substring of the current user message.
- The server rejects unrecognized aspects, vehicles, constraints, or citation IDs.
- The system prompt requires the model to:
  - use only supplied evidence
  - treat review content as untrusted data rather than instructions
  - ignore instructions contained inside evidence
  - distinguish reviewer opinion from objective claims
  - report unresolved discrepancies without inventing a cause
  - treat `partial_update` articles as incomplete coverage
  - avoid choosing the final vehicle
  - abstain when evidence is insufficient

#### Recommendation engine

- Hard constraints are evaluated first.
- A known hard-constraint failure eliminates a vehicle.
- `insufficient_evidence` does not count as a failure, but it blocks a confident recommendation when the constraint is mandatory.
- Explicitly ordered priorities use lexicographic evaluation.
- If the highest-priority aspect is tied or unsupported, evaluation moves to the next priority.
- Without ordered priorities, Pareto dominance is required for a single winner.
- A cross-aspect trade-off produces no winner and one focused follow-up question.
- Chunk count is never treated as a vote.
- The recommendation is limited to vehicles represented in the indexed corpus.
- For recommendation requests, retrieval includes:
  - one targeted evidence query per hard constraint and vehicle, up to 2 chunks
  - one targeted evidence query per selected priority aspect and vehicle, up to 2 chunks
  - deduplication by chunk ID
  - a final context cap of 9 chunks

#### Streaming and user-facing response

- The UI streams stage events, not unvalidated answer tokens.
- Stage events:

```text
request_started
query_understood
retrieval_complete
analyzing
final_response
```

- The final response is displayed only after:
  - structured output validation
  - citation validation
  - recommendation-engine execution
  - source-card construction
- The final user-facing answer includes:
  - recommendation or explicit trade-off status
  - concise overview
  - 2 to 4 relevant aspect explanations
  - inline numbered citations
  - source cards with article title, section, excerpt, and URL
  - missing-information statement where relevant
  - one follow-up question only when it changes the decision
- Source excerpts are initially truncated to 700 characters with an expandable full-chunk view.

#### API limits and timeouts

```text
POST /api/chat
GET /api/health
```

- Maximum user message length: 2,000 characters.
- Maximum recent conversation turns: 2.
- Maximum total recent-turn text: 4,000 characters.
- Maximum active or comparison vehicles: 4.
- Maximum messages in one browser session: 30.
- Embedding request timeout: 10 seconds.
- Qdrant request timeout: 10 seconds.
- Generation request timeout: 35 seconds.
- Vercel route maximum duration: 60 seconds.
- `/api/health` verifies configuration and Qdrant collection access.
- `/api/health` does not make a paid OpenAI request.
- The browser calls same-origin application routes only.
- CORS is not enabled for arbitrary external origins.

#### Rate limiting

- Rate limiting uses Upstash Redis and `@upstash/ratelimit`.
- Algorithm: sliding window.
- Burst limit: 8 chat requests per 60 seconds per hashed IP.
- Daily limit: 60 chat requests per 24 hours per hashed IP.
- Session limit: 30 user messages.
- The raw IP address is not stored.
- The identifier is an HMAC-SHA-256 hash of the forwarded IP using `RATE_LIMIT_SECRET`.
- Rate-limited responses return HTTP 429 and `Retry-After`.
- Required variables:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
RATE_LIMIT_SECRET
```

#### Logging

- Logs are structured JSON written to standard output.
- Production logs include:
  - `request_id`
  - route
  - resolved vehicle IDs
  - resolved aspects
  - selected chunk IDs
  - stage latencies
  - token counts
  - estimated OpenAI cost
  - decision rule
  - final status
  - retry count
- Production logs do not include:
  - full user messages
  - full prompts
  - retrieved text
  - API keys
  - embeddings
  - full conversation history
- Full content logging is allowed only in local `DEBUG_MODE`.

#### UI and repository

- The UI is a fork of the Vercel AI Chatbot Template.
- The fork records the upstream commit SHA in `UPSTREAM.md`.
- Package versions and the lockfile are committed.
- Retained components:
  - chat layout
  - message rendering
  - AI SDK stream handling
  - shadcn/ui
  - Tailwind
  - loading and error states
- Removed components:
  - Auth.js
  - Neon and Drizzle persistence
  - Vercel Blob
  - saved conversations
  - file uploads
  - artifacts
  - model selector
  - multimodal input
  - generic tools
  - AI Gateway integration
- The interface is Hebrew-first and fully RTL.
- Source text is rendered as plain text, never raw HTML.
- External source links use `noopener` and `noreferrer`.

#### Toolchain and CI

```text
Python: 3.12
Python environment: uv
Python lint and format: Ruff
Python typing: mypy
Python tests: pytest

Node.js: 22 LTS
Package manager: pnpm
Web lint and format: Biome
Web unit tests: Vitest
Browser tests: Playwright Test
```

- Browser tests use Playwright Test only as an end-to-end testing framework. Playwright is not used for scraping.
- GitHub Actions runs:
  - Python lint
  - Python type check
  - Python tests
  - Web lint
  - Web type check
  - Web unit tests
  - Web production build
- CI uses mocks and fixtures and does not make live OpenAI or Qdrant calls.
- A manual smoke-test workflow may use repository secrets.
- Raw HTML, complete scraped article text, model weights, and vector indexes are not committed.
- The repository includes:
  - source manifest
  - schemas
  - synthetic extraction fixtures
  - the Hebrew golden evaluation set
  - one small redacted or synthetic processed-document example

#### Evaluation release gates

The POC is not accepted unless all of the following pass:

```text
All 8 approved articles indexed successfully
Vehicle resolution accuracy = 100%
Recall@5 >= 0.85
Precision@5 >= 0.70
Balanced evidence coverage >= 0.90
Citation validity = 100%
Claim support rate >= 0.95
Unsupported claim rate = 0%
Abstention accuracy = 100%
Hard-constraint compliance = 100%
Lexicographic consistency = 100%
Pareto consistency = 100%
Session-memory scenario success = 100%
```

Hybrid retrieval is accepted only if it improves either Recall@5 or balanced evidence coverage over dense-only retrieval without degrading the other metric by more than 0.02.

If `text-embedding-3-small` fails the retrieval gates, release is blocked and the embedding-model decision is reopened. The system does not silently switch models.

Two real failure cases and their causes must be included in the final evaluation report.


---

## 1. Executive Summary

This project is a proof-of-concept conversational AI system that helps users understand, compare, and choose cars based exclusively on real automotive review articles.

The purpose is not to build a production-ready marketplace or a generic car assistant. The purpose is to demonstrate:

- Effective processing of unstructured real-world text
- Clear architectural reasoning
- Practical use of retrieval, NLP, embeddings, and language models
- Grounded answers with source-level evidence
- Conversational preference discovery
- Explainable comparison and recommendation logic
- Sensible cost, reliability, and deployment trade-offs

The deployed POC will use a custom interface based on the Vercel AI Chatbot Template. The online application will run as a Next.js application on Vercel. Scraping, text processing, chunking, indexing, and evaluation will run as an offline Python pipeline.

The chatbot will only use the supplied automotive review articles. It will not use web search, live vehicle pricing, dealership inventory, historical reliability datasets, or external specifications.

---

## 2. Product Definition

### 2.1 Product Positioning

The product is an:

> Evidence-first conversational car advisor

It explains individual vehicles, compares multiple vehicles, gradually learns the user's priorities during the current conversation, and provides evidence-based recommendations.

The system does not generate opaque numerical scores and does not claim that one vehicle is universally best.

### 2.2 Primary Capabilities

The chatbot must support four core interaction types.

#### Vehicle understanding

Examples:

- What are the main strengths of the MG S6?
- What does the review say about the ride comfort of the Aion HT?
- What are the weaknesses of the Citroen C3?

#### Vehicle comparison

Examples:

- Compare the Audi RS3 and Hyundai Elantra N for performance and daily use.
- Which is more suitable for long trips, the Kia EV9 or Genesis GV80?
- Compare the interior quality and practicality of two vehicles.

#### Recommendation based on needs

Examples:

- Which car is most suitable for a family with three children?
- I care more about comfort and space than performance.
- I need seven seats and drive mostly on highways.

#### Progressive conversational preference learning

The system should understand follow-up questions such as:

- What about their comfort?
- Which one is better for me?
- Why?
- What about the second one?

It should maintain context only during the current conversation.

### 2.3 Product Principles

The system must:

- Answer only from indexed review content
- Cite the evidence supporting each material claim
- Distinguish reviewer opinion from objective data
- State clearly when information is missing
- Avoid treating missing information as negative evidence
- Avoid recommending a vehicle that violates an explicit hard constraint
- Avoid declaring a universal winner without user context
- Avoid using model knowledge that is not present in the retrieved sources
- Avoid inventing numerical rankings or scores

### 2.4 Out of Scope

The POC will not include:

- Live prices
- Dealer inventory
- Used-car listings
- Financing calculations
- Insurance costs
- External reliability data
- Long-term ownership data not present in the articles
- Web search
- User authentication
- User accounts
- Persistent chat history
- Long-term memory
- File uploads
- Image analysis
- Multimodal input
- Admin interface
- Automated crawling schedule
- Fine-tuning
- Numerical car scoring
- Agent frameworks
- Tool-calling loops

---

## 3. Data Sources

The POC will ingest the following eight road-test articles:

1. Citroen C3 2026  
   `https://www.auto.co.il/articles/test-drives/road-tests/citroen-c3-2026/`
2. Audi RS3 facelift  
   `https://www.auto.co.il/articles/test-drives/road-tests/audi-rs3-fl/`
3. Kia EV9 long-term report  
   `https://www.auto.co.il/articles/test-drives/road-tests/long-term-report-kia-ev9-4/`
4. MG S6  
   `https://www.auto.co.il/articles/test-drives/road-tests/mg-s6/`
5. Hyundai Elantra N manual  
   `https://www.auto.co.il/articles/test-drives/road-tests/hyundai-elantra-n-manual/`
6. Aion HT  
   `https://www.auto.co.il/articles/test-drives/road-tests/aion-ht/`
7. Lynk & Co 01 2026  
   `https://www.auto.co.il/articles/test-drives/road-tests/link-and-co-01-2026/`
8. Genesis GV80 2026  
   `https://www.auto.co.il/articles/test-drives/road-tests/genesis-gv80-2026/`

No additional content sources are required.

The architecture should remain suitable for a future corpus containing hundreds of thousands of review articles, even though only eight articles are used in the POC.

---

## 4. High-Level Architecture

```text
Offline Python Pipeline
    |
    |-- Scrapy ingestion
    |-- Deterministic extraction
    |-- Document construction
    |-- Structure-aware chunking
    |-- OpenAI `text-embedding-3-small` dense embeddings
    |-- BM25 sparse representation
    |-- Qdrant indexing
    |-- Evaluation scripts
    |
    v
Qdrant Cloud
    |
    v
Next.js Application on Vercel
    |
    |-- Custom Vercel Chatbot Template UI
    |-- Session-scoped conversation state
    |-- Vehicle resolution
    |-- Hybrid retrieval orchestration
    |-- Context engineering
    |-- One structured `gpt-5.6-terra` generation call
    |-- Deterministic recommendation engine
    |-- Citation rendering
    |
    v
Grounded Response with Sources
```

---

## 5. Ingestion Architecture

### 5.1 Selected Tool

Scrapy will be used for scraping.

### 5.2 Why Scrapy

Scrapy is appropriate because:

- All eight pages come from the same website
- The article content is available through normal HTTP
- CSS and XPath selectors provide deterministic extraction
- It supports retries, request scheduling, throttling, pipelines, and deduplication
- It provides a reasonable path toward larger-scale crawling
- It avoids unnecessary browser rendering and browser dependencies
- It demonstrates direct work with unstructured website content

### 5.3 Browser Rendering Decision

Playwright is not part of the POC ingestion pipeline.

The eight approved pages must be extracted through normal HTTP using Scrapy. If the ingestion spike cannot satisfy the extraction acceptance tests, the `AutoCoIlAdapter` must be corrected. A browser is not introduced to hide incorrect source extraction.

Playwright Test remains available only for browser-level UI testing.

### 5.4 Why Not Crawl4AI

Crawl4AI provides useful browser, Markdown, and content-cleaning abstractions, but those capabilities are not required for this corpus.

Using it would hide some of the extraction work that the assignment is intended to demonstrate.

The POC benefits more from explicit selectors, validation, and a custom document schema.

### 5.5 Ingestion Inputs

The POC will use an explicit URL manifest.

```json
{
  "sources": [
    {
      "url": "https://www.auto.co.il/...",
      "enabled": true
    }
  ]
}
```

The URL source must remain separate from spider logic.

A future implementation may replace the static list with:

- Sitemap discovery
- Category-page discovery
- A task queue
- A document registry

### 5.6 Ingestion Outputs

Each article becomes one canonical document.

The pipeline should preserve:

- Article URL
- Article title
- Vehicle metadata
- Section headings
- Paragraph order
- Content hash
- Raw HTML path for debugging

The pipeline should exclude:

- Navigation
- Menus
- Advertisements
- Comments
- Images
- Image captions unless later proven useful
- Related articles
- Cookie banners
- Existing AI-generated summaries
- Hidden or irrelevant page elements

### 5.7 Raw HTML

Raw HTML will be stored locally for reproducibility and debugging.

It will not be:

- Sent to the LLM
- Indexed in Qdrant
- Rendered directly in the UI
- Treated as a trusted input

---

## 6. Canonical Document Model

### 6.1 Document Boundary

Each article is one document.

### 6.2 Internal Structure

Each document is divided according to the article's original headings.

A section starts at a heading and continues until the next heading.

```json
{
  "document_id": "mg_s6_review",
  "url": "https://...",
  "title": "MG S6 Road Test",
  "vehicle": {
    "make": "MG",
    "model": "S6",
    "model_year": null,
    "trim": null
  },
  "sections": [
    {
      "heading": "Design and Appearance",
      "paragraphs": [
        "First paragraph...",
        "Second paragraph..."
      ]
    },
    {
      "heading": "Ride and Handling",
      "paragraphs": [
        "First paragraph...",
        "Second paragraph..."
      ]
    }
  ]
}
```

### 6.3 Introduction

Text appearing before the first heading will be stored as an internal `introduction` section.

### 6.4 Missing Information

Missing values will be stored as `null`.

The system will not infer or guess:

- Trim
- Model year
- Version
- Powertrain
- Price
- Specification details

unless the information is explicitly and reliably available in the extracted content.

### 6.5 Deterministic Extraction Only

No LLM will be used during ingestion.

Deterministic extraction includes:

- CSS or XPath selectors
- Whitespace cleanup
- Heading detection
- Paragraph collection
- Explicit metadata parsing
- Simple regular expressions
- Brand and model alias mapping

The LLM will not be used for:

- Summarization
- Topic classification
- Sentiment extraction
- Advantage or disadvantage extraction
- Fact extraction
- Semantic segmentation
- Review normalization

This decision reduces:

- Cost
- Reprocessing expense
- Non-determinism
- Hidden extraction errors
- Model dependency in the offline pipeline

---

## 7. Chunking Strategy

### 7.1 Selected Strategy

Structure-aware paragraph grouping.

### 7.2 Rules

- Paragraphs are grouped only within the same section
- A chunk never crosses a section boundary
- Target size is approximately 350 to 500 tokens
- Paragraphs are never cut unnecessarily
- A short section remains a standalone chunk
- A very long paragraph may be split by sentence boundaries
- No fixed overlap is used

### 7.3 Why Not Whole-Document Chunks

Whole documents would:

- Introduce irrelevant context
- Increase token cost
- Reduce retrieval precision
- Make balanced vehicle comparison difficult

### 7.4 Why Not Single-Paragraph Chunks

Single paragraphs may:

- Lose pronoun context
- Depend on previous paragraphs
- Fragment arguments
- Require too many retrieved chunks

### 7.5 Why No Fixed Overlap

Fixed overlap would create:

- Duplicate evidence
- Repeated results
- Increased index size
- Increased context cost
- Potential double weighting of the same claim

If evaluation reveals boundary failures, the grouping rules will be adjusted rather than adding overlap automatically.

### 7.6 Embedding Text

The original content remains separate from the text used for embeddings.

```text
Vehicle: MG S6
Article: MG S6 Road Test
Section: Ride and Handling

[Original chunk content]
```

The enriched text improves retrieval when the paragraph itself does not repeat the vehicle or section name.

### 7.7 Chunk Metadata

Each chunk includes:

```json
{
  "chunk_id": "mg_s6_section_4_chunk_1",
  "document_id": "mg_s6_review",
  "vehicle_id": "mg_s6",
  "vehicle_make": "MG",
  "vehicle_model": "S6",
  "model_year": null,
  "section_heading": "Ride and Handling",
  "chunk_index": 1,
  "content": "...",
  "source_url": "https://...",
  "token_count": 426
}
```

---

## 8. Vector Storage and Indexing

### 8.1 Selected Database

Qdrant.

### 8.2 Why Qdrant

Qdrant provides:

- Dense vector storage
- Sparse vector storage
- Hybrid retrieval
- Payload metadata
- Metadata filters
- RRF fusion
- Deletion by document
- Persistence
- A direct path from POC to a managed deployment

### 8.3 Collection Definition

A collection is a logical vector index, comparable to a table with vector configuration and payload metadata.

The system will use one shared collection:

```text
car_review_chunks_v1
```

### 8.4 Why One Collection

Vehicles will not receive separate collections.

Even with hundreds of thousands of vehicles, collection-per-vehicle would create:

- Excessive index-management overhead
- Hundreds of thousands of tiny indexes
- Expensive cross-vehicle comparisons
- Complex backup and monitoring
- Difficult global recommendation queries

Vehicle isolation will use indexed payload fields such as:

- `vehicle_id`
- `document_id`
- `vehicle_make`
- `vehicle_model`
- `model_year`

### 8.5 When Multiple Collections Would Be Appropriate

Separate collections may be justified for:

- Different embedding models
- Different vector dimensions
- Different media types
- Security isolation
- Different data lifecycles
- Different search behaviors

### 8.6 Source of Truth

Qdrant is an index, not the canonical source of processed article content.

Canonical processed documents remain in JSON or JSONL.

The entire Qdrant collection must be rebuildable from processed files.

---

## 9. Hybrid Retrieval

### 9.1 Selected Strategy

Hybrid retrieval using:

- Dense semantic vectors
- BM25 sparse vectors
- Reciprocal Rank Fusion

### 9.2 Dense Retrieval

Dense retrieval handles semantic mismatches.

Example:

User query:

> Which car is suitable for a family with three children?

Source content:

> The second row is spacious, entry is convenient, and the trunk remains useful with all seats occupied.

Dense retrieval should connect the need to the description even without exact keyword overlap.

### 9.3 Sparse Retrieval

BM25 handles exact lexical signals such as:

- Vehicle names
- Trim names
- Technical terminology
- Numbers
- Abbreviations
- Manual transmission
- Seven seats
- 800-volt architecture

### 9.4 Fusion

Dense results and sparse results are fused using RRF.

RRF combines ranking positions rather than directly comparing cosine and BM25 scores.

### 9.5 Dense Similarity

The dense named vector uses:

```text
Distance: cosine
Dimensions: 1536
```

Cosine applies only to the dense vector.

The sparse BM25 representation is configured separately.

### 9.6 Named Vectors

```text
dense
- text-embedding-3-small
- 1536 dimensions
- cosine similarity

sparse
- BM25 sparse representation

fusion
- RRF
```

### 9.7 Entity Filtering

Vehicle names should not rely solely on sparse retrieval.

When a user explicitly mentions a vehicle:

1. Resolve the mention to a canonical `vehicle_id`
2. Apply a metadata filter
3. Run hybrid retrieval inside the filtered result space

Entity filtering determines where to search.

Hybrid retrieval determines which chunks inside that space are most relevant.

---


### 9.8 Sparse Encoding Implementation

The POC uses Qdrant server-side inference model `qdrant/bm25` for both document indexing and online query encoding.

This is a binding decision because the offline pipeline is Python and the online application is TypeScript. Server-side inference ensures that both sides use the same tokenizer, vocabulary, term-frequency logic, and sparse-vector representation.

The POC does not implement a custom BM25 tokenizer, does not export a vocabulary file, and does not reproduce BM25 logic independently in two languages.


---

## 10. Embedding Model

### 10.1 Selected Model

```text
text-embedding-3-small
```

### 10.2 Configuration

- Default dimension: 1536
- Similarity metric: cosine
- Same model for document and query embeddings
- Same preprocessing for indexing and online queries
- OpenAI API used for both indexing and queries

### 10.3 Why This Model

The model was selected because it offers:

- Simple managed API access
- No self-hosted inference service
- No model download or cold-start management
- Straightforward integration with Vercel
- Low per-token cost
- The same OpenAI API key can be used for embeddings and generation
- Strong enough multilingual capability to serve as a practical baseline
- Easy replacement behind an embedding provider interface

### 10.4 Important Limitation

The model is not assumed to be optimal for Hebrew.

It must pass the Hebrew retrieval evaluation before being considered accepted.

### 10.5 Embedding Provider Interface

The implementation should still isolate provider-specific code behind a small interface:

```text
EmbeddingProvider
    embed_documents(texts)
    embed_query(query)
    dimensions
    model_version
```

The selected POC implementation is OpenAI `text-embedding-3-small`. The interface exists to avoid coupling retrieval logic to the SDK, not because multiple embedding providers will be implemented in the POC.

### 10.6 Reindexing Requirement

Changing any of the following requires a new collection:

- Embedding model
- Vector dimensions
- Major preprocessing logic
- Chunking strategy
- Sparse representation method

Vectors from different embedding spaces must never be mixed.

---

## 11. Vehicle Resolution and Query Planning

### 11.1 Selected Strategy

Deterministic vehicle resolution.

The corpus contains a known set of vehicles, so open-ended NER is unnecessary.

### 11.2 Vehicle Catalog

```json
{
  "vehicle_id": "hyundai_elantra_n_manual",
  "canonical_name": "Hyundai Elantra N",
  "aliases": [
    "Elantra N",
    "Hyundai Elantra",
    "יונדאי אלנטרה N",
    "אלנטרה N"
  ]
}
```

### 11.3 No LLM Query Planner

The system will not use an LLM for:

- Intent classification
- Vehicle extraction
- Query rewriting
- Query expansion
- Filter generation

This avoids:

- Additional model calls
- Additional latency
- Query drift
- Higher cost
- Harder debugging

### 11.4 Retrieval Routes

The number of resolved vehicles determines the route.

#### One vehicle

```text
Filter by vehicle_id
Hybrid retrieval
Top 5 chunks
```

#### Two to four vehicles

Run separate retrieval operations in parallel.

```text
Vehicle A -> Top 3
Vehicle B -> Top 3
```

This ensures balanced evidence.

#### No explicit vehicle

Run open candidate discovery:

1. Hybrid search over the full collection
2. Group results by `vehicle_id`
3. Select the top three candidate vehicles
4. Run balanced evidence retrieval for each candidate

### 11.5 Why Separate Retrieval Per Vehicle

A single query with multiple vehicle filters may return most chunks from only one vehicle.

Balanced retrieval prevents recommendation bias caused by:

- Different article lengths
- Different writing styles
- Different chunk counts
- Different lexical similarity

---


### 11.5 Approved Aspect Vocabulary

```text
ride_comfort
space_practicality
performance
handling
interior_quality
usability_ergonomics
efficiency_range
refinement
value_for_money
safety_equipment
design
```

Hebrew and English aliases map deterministically to these values.

At most three aspects are evaluated in a single answer. When the user explicitly orders more than three priorities, only the first three are used and that scope is stated in the answer.

An open “best car” request without a recognized preference, hard constraint, usage pattern, or active vehicle produces one clarification question before retrieval.


---

## 12. Reranking Decision

### 12.1 POC Decision

No neural reranker.

The final retrieval ranking uses:

- Dense retrieval
- BM25 retrieval
- RRF
- Metadata filtering
- Balanced evidence selection

### 12.2 Why No Cross-Encoder

A reranker would add:

- Another model
- More memory
- More latency
- More deployment complexity
- Inference for every query-chunk pair

It is not justified unless evaluation shows:

- The correct chunk is often in the top 10 but not the top 3
- Context precision remains low
- Lexically similar but irrelevant chunks outrank better evidence

### 12.3 Why No LLM Reranking

LLM reranking would add:

- An additional paid model call
- More latency
- Less deterministic behavior
- Another source of hallucination

### 12.4 Production Upgrade Condition

A cross-encoder may be added only if measured ranking failures justify it.

---

## 13. Context Engineering

### 13.1 Purpose

The context engineering layer transforms:

- The current user query
- Validated session state
- Active vehicles
- User constraints and preferences
- Retrieved evidence
- Citation identifiers

into a structured, token-bounded model input.

### 13.2 Context Structure

```text
SYSTEM RULES

USER REQUEST

SESSION PREFERENCES

ACTIVE VEHICLES

UNTRUSTED REVIEW EVIDENCE

Vehicle: Kia EV9

[C1]
Section: Practicality
Content: ...

[C2]
Section: Ride Comfort
Content: ...

Vehicle: Genesis GV80

[C3]
Section: Interior
Content: ...
```

### 13.3 Context Budget

Initial limits:

| Query Type | Maximum Chunks |
|---|---:|
| Single vehicle | 5 |
| Two-vehicle comparison | 6 |
| Three-vehicle comparison | 9 |
| Open recommendation | 9 |

### 13.4 Evidence Grouping

Evidence is grouped by:

- Vehicle
- Section
- Comparison aspect

This helps the model compare the correct evidence and prevents one vehicle from dominating the prompt.

### 13.5 Prompt Engineering vs Context Engineering

Prompt engineering provides instructions.

Context engineering determines:

- Which evidence is included
- How it is grouped
- Which preferences are relevant
- Which information is excluded
- How much context is allowed
- How citations are represented

---

## 14. Language Model Generation

### 14.1 Selected Model and Configuration

```text
Model: gpt-5.6-terra
API: OpenAI Responses API
Reasoning effort: low
Tools: none
Web search: disabled
File search: disabled
Output: strict JSON Schema structured output
Normal successful generation calls per user turn: 1
```

`gpt-5.6-terra` was selected as the balanced capability-and-cost tier. The model receives a narrowly scoped evidence package and does not perform retrieval, tool use, or final recommendation selection.

The same server-side `OPENAI_API_KEY` may be used for both `text-embedding-3-small` and `gpt-5.6-terra` in the POC.

### 14.2 Generation Responsibilities

One language-model call should produce:

- Natural-language evidence synthesis
- Aspect-by-aspect comparison
- Source citation IDs
- Missing-information indicators
- Preference updates
- A follow-up question when necessary

The model must not:

- Query Qdrant
- Choose filters
- Access tools
- Search the web
- Create source URLs
- Select the final recommended vehicle
- Store conversation state
- Use external automotive knowledge

### 14.3 One-Call Policy

The successful path uses:

- One embedding API call
- One structured language-model generation call

There are no additional LLM calls for:

- Query rewriting
- Intent classification
- Preference extraction
- Reranking
- Fact checking
- Recommendation selection

### 14.4 Structured Output

The model must return strict structured output.

Example:

```json
{
  "status": "complete",
  "response_summary": "The vehicles offer different strengths.",
  "aspect_comparisons": [
    {
      "aspect": "ride_comfort",
      "outcome": "kia_ev9",
      "explanation": "The EV9 review describes stronger long-distance comfort.",
      "citation_ids": ["C1", "C2"]
    }
  ],
  "missing_information": [],
  "preference_updates": [],
  "follow_up_question": null
}
```

### 14.5 Allowed Status Values

```text
complete
partial
insufficient_evidence
clarification_required
out_of_scope
```

### 14.6 Validation

Before display:

- Every citation ID must exist in the supplied context
- Every vehicle ID must be an approved candidate
- Every aspect must exist in the approved enum
- No recommendation may be displayed when evidence is insufficient
- URLs must come from stored metadata
- Preference updates must pass validation

### 14.7 Streaming

The POC will not display unvalidated answer text token by token.

Instead, the UI will stream processing stages:

```text
query_understood
retrieval_complete
analyzing
final_response
```

The final answer is displayed only after:

- Structured output is complete
- Schema validation passes
- Citation validation passes
- The recommendation engine runs
- The final response is assembled

This prioritizes reliability over a typing animation.

---


### 14.8 Locked Structured Output Schema

The model returns the following logical structure:

```text
status
mode
overview
aspect_assessments[]
constraint_assessments[]
missing_information[]
preference_updates[]
usage_pattern_updates[]
follow_up_question
```

The schema contains no final recommendation field.

Every answer block and aspect assessment must contain valid citation IDs. Any unrecognized citation, vehicle, aspect, constraint, or enum value invalidates the response.

Preference and usage updates include exact `evidence_text` copied from the current user message. The server rejects updates whose evidence is not an exact substring.

The application uses `@ai-sdk/openai` directly with the OpenAI Responses API. Vercel AI Gateway is not used.


---

## 15. Citation and Source Rendering

### 15.1 Citation Granularity

Every material answer block should contain at least one citation.

Weak approach:

> Sources: Kia EV9 article, Genesis GV80 article

Selected approach:

> The EV9 offers stronger family practicality and seven-seat usability. [1]

### 15.2 Source Construction

The model returns internal citation IDs only.

```json
{
  "text": "The EV9 provides stronger family practicality.",
  "citation_ids": ["C1"]
}
```

The application maps:

```text
C1
-> chunk_id
-> article title
-> section heading
-> source URL
-> original excerpt
```

### 15.3 Source Cards

The UI should display:

- Citation number
- Vehicle name
- Article title
- Section heading
- Source excerpt
- Link to the original article

### 15.4 Why the Model Does Not Generate URLs

This prevents:

- Invented URLs
- Incorrect source attribution
- Citations to unseen content
- Broken source links


### 15.5 Final Answer Requirement

The user-facing final response must include the sources used to support it.

Each material statement is rendered with one or more citation markers. The source panel exposes the original retrieved excerpt and a link to the supplied Auto.co.il article. A response without supporting source references is considered invalid unless the response is an abstention or clarification request.


---

## 16. Session Memory

### 16.1 Memory Scope

The chatbot uses short-term session memory only.

There is no long-term memory.

### 16.2 Lifecycle

- A new session starts with an empty state
- Memory exists only during the current conversation
- New Conversation resets the state
- No profile is reused across conversations
- No conversation history is stored in a database

### 16.3 State Structure

```json
{
  "active_vehicle_ids": [
    "kia_ev9",
    "genesis_gv80"
  ],
  "comparison_vehicle_ids": [
    "kia_ev9",
    "genesis_gv80"
  ],
  "preferences": {
    "priorities": [
      "ride_comfort",
      "interior_space"
    ],
    "constraints": [
      "seven_seats"
    ],
    "usage_patterns": [
      "long_distance_driving"
    ]
  },
  "recent_turns": []
}
```

### 16.4 Explicit vs Inferred Preferences

Explicit preferences are stored immediately.

Examples:

- Comfort is more important to me than performance
- I need seven seats
- I do not want an electric car
- I mostly drive on highways

A one-time question does not become a preference.

Example:

> How is the RS3's performance?

This does not prove that performance is a long-term priority.

### 16.5 Preference Updates

Preference extraction occurs inside the existing generation call.

No separate LLM request is used.

### 16.6 Client-Side State

Because there is no persistence database, session state is kept in the browser and sent with each request.

The server validates it and returns a canonical updated state.


### 16.7 Persistence Boundary

Conversation state is stored in browser `sessionStorage`.

- It survives refreshes within the same browser tab
- It is cleared when the tab session ends
- New Conversation clears it immediately and creates a new UUID
- `localStorage` is not used
- No user profile is created
- No cross-session personalization is implemented
- No server-side long-term memory is implemented
- No conversation state is written to a database


---

## 17. Comparison and Recommendation Logic

### 17.1 Design Principle

The system must not:

- Let the LLM choose arbitrarily
- Generate universal rankings
- Assign fake numerical scores
- Count chunks as votes
- Treat missing evidence as a weakness

### 17.2 Selected Policy

```text
Hard constraints
    ->
Aspect-by-aspect evidence assessment
    ->
Deterministic decision policy
```

### 17.3 Hard Constraints

Examples:

- Seven seats
- Electric only
- Automatic transmission
- Maximum budget
- Mandatory use case

Possible states:

```text
satisfied
not_satisfied
partially_satisfied
insufficient_evidence
```

Rules:

- A vehicle known to violate a hard constraint is eliminated
- A vehicle with missing evidence is not automatically eliminated
- A vehicle with unverified mandatory criteria cannot receive a confident recommendation

### 17.4 Aspect Evaluation

Relevant aspects may include:

- Ride comfort
- Interior space
- Practicality
- Performance
- Interior quality
- Range
- Efficiency
- Value for money

The LLM evaluates evidence per aspect but does not choose the final vehicle.

### 17.5 Lexicographic Decision Rule

When the user explicitly ranks priorities:

1. Evaluate the highest-priority aspect
2. If there is a clear winner, that aspect decides
3. If tied or unsupported, move to the next priority

Example:

```text
Priority 1: comfort
Priority 2: interior quality
Priority 3: performance
```

If one vehicle clearly wins on comfort, lower-priority aspects do not override it.

### 17.6 Pareto Dominance

When the user does not rank priorities, the system uses Pareto dominance.

A vehicle may be recommended only if:

- It is not worse on any relevant aspect
- It is better on at least one relevant aspect

If one vehicle is better in comfort and another is better in performance, there is no universal winner.

The answer should explain the trade-off and ask a focused follow-up question.

### 17.7 Mixed Evidence

If a review says:

> Comfortable on highways, but unsettled on urban road imperfections

the outcome is conditional, not simply positive or negative.

Usage patterns from session memory determine whether the condition matters.

### 17.8 Decision Ownership

The LLM returns evidence assessment.

The application code returns the final recommendation.

---

## 18. Evaluation Plan

### 18.1 Golden Dataset

Create a manually labeled Hebrew evaluation set with 30 queries.

Suggested distribution:

| Query Type | Count |
|---|---:|
| Single-vehicle questions | 10 |
| Vehicle comparisons | 8 |
| Recommendations | 6 |
| Unanswerable questions | 3 |
| Follow-up and memory scenarios | 3 |
| Total | 30 |

### 18.2 Per-Query Labels

Each evaluation item should include:

```json
{
  "query": "Which is better for a family, EV9 or GV80?",
  "expected_vehicle_ids": [
    "kia_ev9",
    "genesis_gv80"
  ],
  "relevant_aspects": [
    "interior_space",
    "ride_comfort",
    "practicality"
  ],
  "relevant_chunk_ids": {
    "kia_ev9": ["chunk_12", "chunk_14"],
    "genesis_gv80": ["chunk_29", "chunk_31"]
  },
  "expected_answer_points": [
    "EV9 provides seven-seat practicality",
    "GV80 offers a more premium interior",
    "The recommendation depends on priorities"
  ],
  "expected_decision": "trade_off",
  "forbidden_claims": [
    "long-term reliability",
    "current market price"
  ]
}
```

### 18.3 Retrieval Metrics

#### Vehicle Resolution Accuracy

Target:

```text
100%
```

#### Recall@5

Target:

```text
>= 0.85
```

#### Precision@5

Target:

```text
>= 0.70
```

#### Balanced Evidence Coverage

Checks whether every compared vehicle receives relevant evidence for the requested aspects.

Target:

```text
>= 90%
```

### 18.4 Hybrid Ablation Test

Compare:

1. Dense only
2. BM25 only
3. Hybrid with RRF

Hybrid remains in the architecture only if it provides measurable benefit.

### 18.5 Grounding Metrics

#### Citation validity

Target:

```text
100%
```

#### Claim support rate

Target:

```text
>= 95%
```

#### Unsupported claim rate

Target:

```text
0%
```

#### Answer coverage

Target:

```text
>= 80%
```

### 18.6 Abstention Accuracy

Questions outside the available evidence include:

- Five-year reliability
- Insurance costs
- Resale value
- Common long-term failures
- Parts availability

Target:

```text
100%
```

### 18.7 Recommendation Tests

Unit tests must cover:

- Hard-constraint compliance
- Lexicographic consistency
- Pareto consistency
- Missing-evidence handling
- No numerical scoring
- No LLM-selected final recommendation

Target:

```text
100%
```

### 18.8 Memory Tests

Scenarios:

1. Follow-up vehicle reference
2. Explicit preference retention
3. Preference update
4. One-time question not becoming a preference
5. New session starts empty

Target:

```text
100%
```

### 18.9 Cost and Latency Measurements

Track:

- Retrieval latency
- Generation latency
- Total latency
- Embedding tokens
- LLM input tokens
- LLM output tokens
- Estimated cost
- Number of LLM calls
- Context size
- Retrieved chunk count

---

## 19. User Interface

### 19.1 Selected Base

Vercel AI Chatbot Template.

### 19.2 Why Use a Template

The template already provides:

- Chat layout
- Streaming transport
- Message rendering
- Responsive design
- Loading states
- Error states
- Accessible components
- Tailwind
- shadcn/ui
- Vercel deployment integration

Building these from scratch would not improve retrieval or grounding quality.

### 19.3 What to Keep

- Conversation layout
- Message components
- Responsive UI
- Streaming infrastructure
- Markdown rendering
- Loading states
- Error states
- Tailwind and shadcn/ui

### 19.4 What to Remove

- Authentication
- Database persistence
- Saved conversations
- File uploads
- Vercel Blob
- Artifacts
- Code execution
- Model selector
- Multimodal input
- Generic tools

### 19.5 What to Add

- Full RTL support
- Custom automotive visual design
- Vehicle comparison cards
- Evidence badges
- Source cards
- Expandable review excerpts
- Preference panel
- New Conversation button
- Trade-off indicators
- Missing-information states
- Processing-stage streaming

### 19.6 Product Tone

The interface should look like a professional automotive advisory product, not a generic ChatGPT clone.

---

## 20. Deployment Architecture

### 20.1 Online Application

A single Next.js application deployed on Vercel.

It includes:

- Custom frontend
- Server-side chat route
- Vehicle resolver
- Retrieval orchestrator
- Context builder
- Recommendation engine
- Qdrant client
- OpenAI client

### 20.2 Why No Separate FastAPI Service

A separate Python backend would add:

- Another deployment
- CORS
- Another environment
- Another network hop
- Separate logging
- More failure modes

The online operations are lightweight and can run in Next.js server routes.

Python remains responsible for the offline data pipeline.

### 20.3 Offline Pipeline

Runs locally or in a controlled job:

```text
scrape
-> process
-> chunk
-> embed
-> generate sparse representation
-> index Qdrant
```

### 20.4 Qdrant Deployment

Use Qdrant Cloud for persistent storage.

The application should never depend on local filesystem persistence in Vercel.

### 20.5 Secrets

Server-side environment variables:

```text
OPENAI_API_KEY
QDRANT_URL
QDRANT_API_KEY
QDRANT_COLLECTION
```

No secret may use the `NEXT_PUBLIC_` prefix.

### 20.6 Data Lifecycle

Scraping and indexing do not run during deployment.

Article update flow:

```text
Run ingestion
-> compare content hash
-> process changed documents only
-> delete previous points by document_id
-> insert new chunks
```

### 20.7 Collection Versioning

Example:

```text
car_review_chunks_v1
car_review_chunks_v2
```

Create a new version when changing:

- Embedding model
- Dimensions
- Chunking logic
- Major preprocessing
- Sparse encoding

---

## 21. Observability

### 21.1 POC Decision

Use request-scoped structured JSON logs.

No external observability platform is required in the POC.

### 21.2 Request Trace

Each request receives:

```json
{
  "request_id": "req_8f32",
  "session_id": "session_12",
  "timestamp": "..."
}
```

### 21.3 Logged Stages

- Vehicle resolution
- Retrieval route
- Retrieved chunk IDs
- Context token count
- LLM tokens
- Estimated cost
- Generation latency
- Recommendation rule
- Final status
- Retry count

### 21.4 Do Not Log

- API keys
- Authorization headers
- Full prompts in production
- Raw HTML
- Embeddings
- Full conversation history
- Private user information

### 21.5 Debug Mode

A local debug mode may display:

- Retrieval route
- Vehicles detected
- Chunk count
- Context tokens
- Total latency

It must not expose:

- Secrets
- System prompts
- Raw provider responses

---

## 22. Error Handling

### 22.1 Vehicle Ambiguity

If the user writes:

> What do you think about the S6?

and the reference is ambiguous, the system should ask:

> Did you mean the MG S6?

It should not guess silently.

### 22.2 Insufficient Evidence

If retrieval does not produce enough evidence:

```text
status = insufficient_evidence
```

The system should not call the LLM with weak context solely to produce an answer.

### 22.3 Qdrant Failure

```text
Retrieval unavailable
-> no LLM call
-> safe error message
```

### 22.4 LLM Failure

Allow one retry for:

- Timeout
- Rate limit
- Temporary server failure
- Incomplete response
- Invalid structured output

After the retry, return a safe fallback.

### 22.5 Invalid Citations

If the model returns a citation not present in the context:

- Do not display the answer
- Retry once
- Return a safe fallback if the retry fails

### 22.6 Business Status vs System Error

Valid business statuses:

```text
complete
partial
insufficient_evidence
clarification_required
out_of_scope
```

System errors:

```text
rate_limited
retrieval_unavailable
embedding_failed
generation_failed
invalid_request
```

---

## 23. Cost Controls


### 23.0 Service Cost Decision

The project prioritizes free infrastructure where practical, but the final embedding decision is not free.

- Vercel hosting: target the free Hobby tier for the portfolio POC
- Qdrant Cloud: target the free tier where capacity is sufficient
- Scrapy, Python processing, and local evaluation: free and open source
- `text-embedding-3-small`: paid OpenAI API usage
- `gpt-5.6-terra`: paid OpenAI API usage

Embedding cost is expected to be much smaller than generation cost, but it must not be described as free.


### 23.1 LLM Calls

Normal successful path:

```text
1 query embedding call
1 generation call
```

No generation calls for:

- Query rewriting
- Intent classification
- Preference extraction
- Reranking
- Fact checking
- Recommendation selection

### 23.2 Context Limits

| Query Type | Max Chunks |
|---|---:|
| Single vehicle | 5 |
| Two vehicles | 6 |
| Three vehicles | 9 |
| Open recommendation | 9 |

### 23.3 Output Limits

Typical response:

```text
500 to 700 output tokens
```

Longer output only for complex comparisons.

### 23.4 Vehicle Limits

- Direct comparison: maximum four vehicles
- Open recommendation: maximum three candidates

### 23.5 Caching

Use persistence for document embeddings.

Do not add query-embedding cache in the POC.

Do not cache final LLM answers because they depend on session state and preferences.

---

## 24. Security and Guardrails

### 24.1 Trust Boundaries

```text
Trusted
- System rules
- Application rules
- Recommendation policy

Controlled
- User input
- Session state

Untrusted
- Scraped article content
- Retrieved chunks
```

### 24.2 Prompt Injection Protection

Retrieved text is evidence, not instruction.

The system prompt must state that instructions inside review content must be ignored.

### 24.3 No Tools for the LLM

The LLM receives no access to:

- Qdrant
- Browser
- Web search
- File system
- Shell
- Environment variables
- Scraper
- Internal API
- Database

### 24.4 Backend-Generated Filters

The user never supplies raw Qdrant filters.

The server builds filters only from approved canonical vehicle IDs and enums.

### 24.5 Source Allowlist

The scraper only accepts approved URLs and domains.

No public arbitrary-URL ingestion endpoint is included.

### 24.6 XSS Protection

- Render source excerpts as plain text or sanitized Markdown
- Do not use raw HTML rendering
- Do not use `dangerouslySetInnerHTML`
- Validate source URLs
- Do not render JavaScript URLs

### 24.7 Input Protection

- Message length limit
- Vehicle-count limit
- Rate limiting
- Request timeout
- Output-token limit
- Context-size limit
- Basic concurrency limit

### 24.8 Out-of-Scope Questions

If no relevant evidence is found, the chatbot should state that it is limited to the indexed automotive reviews.

### 24.9 Privacy

- No accounts
- No long-term memory
- No persistent chat database
- New Conversation clears session state
- Logs exclude full conversation history

---


### 24.10 Locked Abuse Controls

Rate limiting uses Upstash Redis with `@upstash/ratelimit`.

```text
Sliding window: 8 requests per 60 seconds per hashed IP
Daily limit: 60 requests per 24 hours per hashed IP
Session limit: 30 user messages
Maximum message length: 2,000 characters
Maximum active vehicles: 4
```

The raw IP is never persisted. The rate-limit identifier is an HMAC-SHA-256 hash using `RATE_LIMIT_SECRET`.

The embedding, Qdrant, and generation timeouts are 10, 10, and 35 seconds respectively. The Vercel chat route has a 60-second maximum duration.


---

## 25. API Contract

### 25.1 Main Endpoint

```text
POST /api/chat
```

### 25.2 Request

```json
{
  "message": "Which is more suitable for a family, EV9 or GV80?",
  "session_id": "temporary-client-session",
  "conversation_state": {
    "active_vehicle_ids": [],
    "comparison_vehicle_ids": [],
    "preferences": [],
    "constraints": [],
    "usage_patterns": []
  },
  "recent_turns": [
    {
      "role": "user",
      "content": "I need a family car for three children."
    },
    {
      "role": "assistant",
      "content": "Is space or comfort more important?"
    }
  ]
}
```

### 25.3 Streaming Events

```text
request_started
vehicle_resolution_complete
retrieval_complete
generation_started
final_response
```

### 25.4 Final Response

```json
{
  "status": "complete",
  "answer_blocks": [
    {
      "text": "The EV9 offers stronger space and family practicality.",
      "citation_ids": ["source_1", "source_2"]
    }
  ],
  "recommendation": {
    "decision": "kia_ev9",
    "decision_rule": "lexicographic",
    "reason": "Space and practicality were ranked above interior quality."
  },
  "sources": [
    {
      "citation_id": "source_1",
      "vehicle_id": "kia_ev9",
      "vehicle_name": "Kia EV9",
      "article_title": "Kia EV9 Long-Term Review",
      "section_heading": "Space and Practicality",
      "excerpt": "Original retrieved excerpt...",
      "url": "https://www.auto.co.il/..."
    }
  ],
  "missing_information": [],
  "follow_up_question": null,
  "updated_state": {
    "active_vehicle_ids": [
      "kia_ev9",
      "genesis_gv80"
    ],
    "comparison_vehicle_ids": [
      "kia_ev9",
      "genesis_gv80"
    ],
    "preferences": [],
    "constraints": [],
    "usage_patterns": []
  },
  "request_metadata": {
    "request_id": "req_123",
    "retrieved_chunks": 6
  }
}
```

### 25.5 Health Endpoint

```text
GET /api/health
```

Example:

```json
{
  "status": "healthy",
  "qdrant": "available",
  "openai_configured": true,
  "collection": "car_review_chunks_v1"
}
```

### 25.6 Endpoints Not Included

```text
POST /api/reindex
POST /api/scrape
POST /api/upload
```

Indexing is an offline administrative process.

---

# 26. End-to-End Online Flow

```text
POST /api/chat
    |
    v
1. Validate request
    |
    v
2. Apply rate and length limits
    |
    v
3. Validate session state
    |
    v
4. Resolve vehicle names and aliases
    |
    v
5. Select retrieval route
    |
    |-- Single vehicle
    |-- Comparison
    |-- Open recommendation
    |
    v
6. Create query embedding
    |
    v
7. Run dense + BM25 retrieval in Qdrant
    |
    v
8. Fuse with RRF
    |
    v
9. Select balanced evidence
    |
    v
10. Build token-bounded context
    |
    v
11. Make one structured LLM call
    |
    v
12. Validate schema and citations
    |
    v
13. Run deterministic recommendation engine
    |
    v
14. Validate preference updates
    |
    v
15. Build source cards and final response
```

---

# 27. Implementation Plan

## Phase 1: Technical Spikes

### Spike A: Scraping

Use one article.

Verify:

- Correct title
- Correct introduction
- Correct section headings
- Correct paragraph grouping
- No navigation or irrelevant content
- Deterministic JSON output

Definition of Done:

- Repeated runs produce the same structured output
- Section boundaries are correct
- No AI summary, comments, images, or menus are included

### Spike B: Hybrid Retrieval

Index 5 to 10 chunks.

Verify:

- Semantic query found by dense retrieval
- Exact model term found by BM25
- Hybrid result improves at least one real case
- Vehicle filter works
- Expected chunk appears in top three

Also verify that sparse generation is identical between:

- Offline Python indexing
- Online TypeScript querying

### Spike C: Structured Generation

Use `gpt-5.6-terra` through the Responses API with manually prepared evidence.

Verify:

- Structured output passes schema
- Citations are valid
- Missing information produces abstention
- No external model knowledge appears
- Preference updates are returned
- No final recommendation is chosen by the model

---

## Phase 2: Full Ingestion

Build:

```text
8 URLs
-> Scrapy
-> Documents
-> Sections
-> Paragraphs
-> JSON
```

Definition of Done:

- All eight articles processed
- Missing metadata stored as `null`
- Raw HTML stored locally
- Content hashes created
- No LLM used
- Re-running does not create duplicates

---

## Phase 3: Chunking and Indexing

Build:

- Structure-aware chunker
- OpenAI `text-embedding-3-small` client
- BM25 sparse representation
- Qdrant upsert pipeline
- Collection versioning
- Delete-by-document workflow

Definition of Done:

- Every chunk exists once
- Every dense vector has 1536 dimensions
- Every chunk has sparse representation
- Collection can be rebuilt from processed JSON
- Document can be replaced by `document_id`

---

## Phase 4: Evaluation Dataset

Create 30 Hebrew queries.

Run:

- Dense only
- BM25 only
- Hybrid RRF

Definition of Done:

- Metrics calculated
- Hybrid justified by results
- Failure cases documented
- Retrieval thresholds evaluated

---

## Phase 5: Retrieval Orchestrator

Implement:

- Vehicle alias resolver
- Single-vehicle route
- Comparison route
- Open recommendation route
- Balanced evidence selection
- Follow-up context handling

Definition of Done:

- Vehicle resolution reaches 100% on the test set
- Both sides of comparisons receive evidence
- No low-evidence query is sent to generation
- Follow-up references use active vehicles

---

## Phase 6: Context and Generation

Implement:

- Context builder
- Citation identifiers
- Structured LLM schema
- Output validation
- Preference-update validation
- Safe fallback responses

Definition of Done:

- Every material claim has a citation
- All citations exist
- No generated URLs
- Unsupported questions abstain
- One generation call in the normal path

---

## Phase 7: Recommendation Engine

Implement as deterministic application logic.

Definition of Done:

- Hard constraints eliminate unsuitable vehicles
- Missing evidence does not count as failure
- Ordered priorities use lexicographic rules
- Unordered priorities use Pareto dominance
- Trade-offs remain trade-offs
- No numerical scores
- No LLM final recommendation

---

## Phase 8: Session Memory

Implement:

- Client-side conversation state
- Active vehicles
- Comparison vehicles
- Preferences
- Constraints
- Usage patterns
- Two recent turns
- New Conversation reset

Definition of Done:

- No long-term memory
- No conversation DB
- New session begins empty
- One-time questions do not become preferences
- New explicit preferences override old conflicting ones

---

## Phase 9: User Interface

Fork and simplify the Vercel Chatbot Template.

Definition of Done:

- Ask about one vehicle
- Compare two vehicles
- Request recommendation
- View source cards
- Expand original evidence
- See preference state
- Reset conversation
- Display trade-off and insufficient-evidence states
- Full RTL support
- Custom automotive visual identity

---

## Phase 10: Security and Reliability

Implement:

- Input validation
- Rate limiting
- Server-side secrets
- Citation validation
- Request timeout
- One retry
- Structured logs
- Health endpoint
- Safe error states
- Untrusted evidence separation

Definition of Done:

- Qdrant failure does not trigger LLM generation
- LLM failure does not produce an ungrounded answer
- User cannot submit raw Qdrant filters
- API keys never reach the client
- Stack traces are not exposed
- Prompt injection cannot access tools because no tools exist

---

## Phase 11: Deployment

Offline:

```text
scrape
-> process
-> chunk
-> embed
-> index Qdrant
```

Online:

```text
Vercel UI
-> /api/chat
-> OpenAI embedding
-> Qdrant hybrid retrieval
-> OpenAI structured generation
-> deterministic recommendation
-> grounded response
```

Definition of Done:

- Public Vercel URL works
- Deployment does not scrape or reindex
- Qdrant data persists independently
- Secrets are configured correctly
- Collection version is environment-controlled
- Frontend redeployment does not affect indexed data

---


## 27A. Locked Toolchain and CI

```text
Python 3.12
uv
Ruff
mypy
pytest

Node.js 22 LTS
pnpm
Biome
Vitest
Playwright Test
```

Playwright Test is used only for browser-level UI tests, not scraping.

GitHub Actions must pass Python linting, Python type checking, Python tests, web linting, web type checking, web unit tests, and a production web build.

CI uses mocks and fixtures and makes no live paid API calls.

---

## 27B. Locked Release Gates

The release is blocked unless all eight sources index successfully and all evaluation thresholds in this document pass.

Hybrid retrieval remains only if it improves Recall@5 or balanced evidence coverage over dense-only retrieval without degrading the other metric by more than two percentage points.

If `text-embedding-3-small` fails the retrieval thresholds, the release is blocked and the embedding decision is reopened. No automatic fallback model is permitted.

The final report must include two genuine failure cases, their root causes, and whether they were fixed or accepted as limitations.

---

# 28. Final Acceptance Scenario

The POC passes only if this conversation works correctly.

### User

> I am looking for a family car for three children. Comfort and space matter more to me than performance.

### Chatbot

- Stores explicit priorities and usage context
- Asks a follow-up only if necessary
- Proposes up to three evidence-backed candidates

### User

> Compare the EV9 and GV80.

### Chatbot

- Retrieves balanced evidence from both vehicles
- Compares relevant aspects
- Cites each material claim
- Avoids a universal winner unless priorities justify one

### User

> What about their comfort on long trips?

### Chatbot

- Remembers both active vehicles
- Uses the existing priority order
- Retrieves long-distance comfort evidence

### User

> Which one is more reliable after five years?

### Chatbot

- States that the indexed reviews do not provide enough evidence
- Does not answer from general model knowledge

---

# 29. Final Scope Summary

## Included

- Scrapy ingestion
- Deterministic document extraction
- Section and paragraph preservation
- Structure-aware chunking
- OpenAI dense embeddings
- BM25 sparse representation
- Qdrant hybrid retrieval
- RRF fusion
- Deterministic vehicle resolution
- Balanced multi-vehicle retrieval
- Context engineering
- One structured LLM call
- Citation-backed answers
- Session-only memory
- Constraint-first recommendation
- Lexicographic priorities
- Pareto dominance
- Hebrew evaluation dataset
- Custom Vercel chatbot UI
- Vercel deployment
- Qdrant Cloud
- Structured logging
- Security guardrails

## Excluded

- Long-term memory
- Authentication
- Persistent chat history
- FastAPI
- Redis
- PostgreSQL
- Neural reranker
- Agent framework
- LLM query rewriting
- LLM ingestion
- Moderation API
- Web search
- File uploads
- Live prices
- Fine-tuning
- Numerical vehicle scores
- Admin UI
- Automated crawling schedule

---

# 30. Core Architectural Statement

> The POC is designed as a production-shaped but implementation-efficient conversational retrieval system. It uses deterministic ingestion, structure-aware chunking, hybrid dense and sparse retrieval, balanced evidence selection, strict context construction, one grounded language-model call, and deterministic recommendation rules. Reliability is achieved through evidence constraints, source-level citations, abstention, and architectural isolation rather than additional model calls or unnecessary infrastructure.

---

# 31. Final Decision Log

| Decision | Status | Final choice |
|---|---|---|
| Scraping framework | Final | Scrapy |
| Browser rendering | Final | Not included in POC ingestion; Scrapy HTTP only |
| Canonical article representation | Final | JSON or JSONL with sections and ordered paragraphs |
| Markdown as canonical storage | Rejected | Markdown may be rendered for display but is not the source of truth |
| Ingestion-time LLM | Rejected | Deterministic extraction only |
| Chunking | Final | 350 to 500 tokens, within section boundaries, no fixed overlap |
| Vector database | Final | Qdrant Cloud |
| Collections | Final | One shared versioned collection |
| Dense retrieval | Final | `text-embedding-3-small`, 1,536 dimensions, cosine |
| Sparse retrieval | Final | Qdrant server-side `qdrant/bm25` for indexing and queries |
| Fusion | Final | RRF |
| Embedding provider | Final | OpenAI |
| Gemini embedding | Not selected | Considered only |
| Granite embedding | Not selected | Self-hosting complexity did not justify it for the deployed POC |
| Reranker | Rejected for POC | Add only after measured ranking failures |
| Query planner | Final | Deterministic |
| LLM query rewriting | Rejected | Original query plus deterministic vehicle filtering |
| Language model | Final | `gpt-5.6-terra` |
| Generation API | Final | OpenAI Responses API |
| Generation pattern | Final | One strict structured-output call |
| Token streaming | Rejected | Stream processing stages, then display a validated final response |
| Citation rendering | Final | Application-resolved source cards and inline citation markers |
| Recommendation logic | Final | Hard constraints, lexicographic priority, Pareto dominance |
| Long-term memory | Rejected | Session memory only |
| UI base | Final | Forked Vercel AI Chatbot Template, direct OpenAI provider, no AI Gateway |
| Online backend | Final | Next.js server routes on Vercel |
| FastAPI and Render | Removed | Not part of the final architecture |
| Evaluation | Final | 30-query manually labeled Hebrew golden dataset |
| Session storage | Final | Browser `sessionStorage`, cleared by New Conversation or tab-session end |
| Rate limiting | Final | Upstash sliding-window limits: 8/minute, 60/day per hashed IP, 30 messages/session |
| Aspect vocabulary | Final | Eleven controlled automotive comparison aspects |
| RRF weighting | Final | Equal dense and sparse contribution, no POC weight tuning |
| Sparse tokenizer ownership | Final | Qdrant server-side inference, no duplicated Python and TypeScript tokenizer |
| CI toolchain | Final | Python 3.12/uv/Ruff/mypy/pytest and Node 22/pnpm/Biome/Vitest/Playwright Test |

