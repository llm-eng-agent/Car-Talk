# Car-Talk — Progress

Progress tracker for the Car-Talk POC (evidence-first automotive review chatbot). Full
design: [`automotive_review_chatbot_spec.md`](automotive_review_chatbot_spec.md).

**How this works:** after each completed step, this file is updated and a PR is opened for
that step. One PR per task; only the owner merges.

Legend: ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked

_Last updated: 2026-07-18 (Phase 10: security + reliability)_

## Status by phase

| Phase | Status | Notes |
|---|---|---|
| Spike A — Scraping | ✅ | Merged in PR #1 |
| Spike B — Hybrid retrieval | ✅ | Ablation run; hybrid kept (best resolution + coverage) |
| Spike C — Structured generation | ✅ | Folded into Phase 6b; gpt-5.6-terra verified live |
| Phase 2 — Full ingestion (8 articles) | ✅ | All 8 extracted + validated; idempotent |
| Phase 3a — Chunking + embeddings | ✅ | 162 chunks embedded (1536-d); cache works |
| Phase 3b — Qdrant indexing | ✅ | 162 points in `car_review_chunks_v1` (dense + BM25) |
| Phase 4 — Evaluation dataset (30 Hebrew queries) | ✅ | Dataset + eval runner + ablation report; gates are a Phase-5 baseline |
| Phase 5 — Retrieval orchestrator | ✅ | 5a: resolver (100%); 5b: live routes + balanced evidence + low-evidence gate |
| Phase 6 — Context + generation | ✅ | 6a: context/citations/schema/validation; 6b: live gpt-5.6-terra call + answer() pipeline (verified live) |
| Phase 7 — Recommendation engine | ✅ | Deterministic: constraints → lexicographic → Pareto → trade-off; wired into answer() |
| Phase 8 — Session memory | ✅ | State model + deterministic reducer/validation in answer(); browser persistence is Phase 9 |
| Phase 9 — User interface (Next.js) | ✅ | Chat UI + /api/chat wrapping answer(); source cards, recommendation/trade-off, preference panel, reset; RTL; §28 Playwright e2e + live smoke |
| Phase 10 — Security + reliability | ✅ | Pluggable rate limit (Upstash/in-memory) + 429; /api/health; structured trace logs (§21.3); hardening tests; most DoD already met in earlier phases |
| Phase 11 — Deployment (Vercel + Qdrant Cloud) | 🔄 | Prep merged (Node pin + `docs/deploy_vercel.md`); Dashboard connect + env + deploy next |

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

## ✅ Phase 5a — web bootstrap + deterministic vehicle resolver

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

## ✅ Phase 5b — live retrieval orchestrator (TypeScript)

The live half of the Phase 5 orchestrator, in the Next.js app (spec §20.1/§11.4). Replaces the
Phase-4b single-pool top-5 with **per-vehicle balanced retrieval**, the fix for the coverage gate.

- **SDKs added to `web/`**: `@qdrant/js-client-rest`, `openai` (server-side only; keys never
  reach the client). Config/clients: `config.ts` (env + `car_review_chunks_v1` default),
  `embedding.ts` (`OpenAIEmbeddingProvider`, 1536-d, dim-validated), `qdrantClient.ts`.
- **`retriever.ts`** — TS port of the Python `HybridRetriever`: dense (client-side OpenAI) +
  BM25 (server-side `qdrant/bm25`) prefetch, RRF fusion, optional `vehicle_id` filter. Client +
  embedder injectable → offline tests. **`factory.ts`** is the composition root (reused by the
  Phase 6 route).
- **`orchestrator.ts`** — routes by resolved-vehicle count (§11.4): 1 → top 5 filtered;
  2–4 → parallel per-vehicle top 3 (balanced); 0 → discovery (global hybrid → top-3 candidates
  by group → balanced top-3 each). **Follow-up** falls back to `activeVehicleIds` (Phase 8
  supplies these). **Low-evidence gate**: single/discovery with 0 chunks, or a comparison with
  <2 evidenced sides → `sufficient:false` → caller abstains, generation never runs.
- **Out-of-corpus gate** (review fix): a query naming a make outside the 8-article corpus
  (e.g. טויוטה קורולה) resolves to no vehicle but must **not** fall through to discovery with
  evidence for unrelated cars (spec line 185 / eval q27). `knownMakes.ts` + curated
  `data/known_makes.json` detect a named-but-unknown brand → `route: "out_of_scope"`,
  `sufficient:false`, `unresolvedMention` set; the retriever is never queried. Genuine
  no-vehicle recommendations still route to discovery. List is curated, not exhaustive.
- **Tests**: 13 offline (fake client/embedder) + a live smoke check (skipped without secrets)
  that verified all three routes against the real collection — single→`mg_s6`, comparison→
  balanced `audi_rs3`+`kia_ev9`, discovery→candidates. `build`/`typecheck` clean.
- Output is an `EvidencePackage` — the input contract for the Phase 6 context builder.

## 🔄 Phase 6a — context builder + citation map + generation schema + validation

The deterministic, offline half of Phase 6 (spec §13–15, §22) — everything around the model call,
no LLM yet. Mirrors the 5a/5b split; the live call (6b) is gated on the model-id blocker.

- **New `web/lib/generation/`**: `schema.ts` (strict structured-output JSON Schema + TS types +
  the status/mode/aspect/constraint enums; no `recommended_vehicle_id` — the model never picks
  the final vehicle), `citations.ts` (deterministic `C1..Cn` map → chunk_id/title/section/url/
  700-char excerpt; model emits IDs only, never URLs), `context.ts` (token-bounded grouped input
  per §13.2/§13.3 — budget caps 5/6/9, evidence grouped by vehicle+section, labelled UNTRUSTED),
  `validate.ts` (every citation exists; material blocks need a citation; aspects/vehicles/
  constraints in-enum; `evidence_text` an exact substring of the user message; no winner under
  insufficient/out-of-scope), `respond.ts` (out_of_scope / low-evidence short-circuit to a
  terminal status **without** calling the model — spec §22.2).
- **RetrievedChunk** extended with `articleTitle` + `sourceUrl` (already in the Qdrant payload).
- **19 offline tests** across the five modules; `test`/`typecheck`/`build` clean.
- Final out_of_scope **wording** finalized in PR #14: a rotating set of witty openers that name
  the make + state the corpus limit (§24.8); insufficient_evidence stays neutral.

## ✅ Phase 6b — live structured generation + answer pipeline

The one grounded generation call and the end-to-end pipeline (spec §14, §22, §23.1).

- **`gpt-5.6-terra` verified live** on the account (GET /v1/models) — the standing blocker is
  cleared; no model substitution. Added `ai` + `@ai-sdk/openai` (direct provider, no AI Gateway).
- **`generate.ts`** — one Responses-API structured-output call (`openai.responses`, reasoning
  effort low, no tools, no temperature, ≤1200 tokens) + server-side validation; **one retry** on
  transient error / invalid schema / invalid citation, else safe fallback. Model is **injectable**
  so retry+validation are unit-tested offline. `systemPrompt.ts` holds the §14.2 rules.
- **`answer.ts`** — full pipeline: `orchestrate → terminal short-circuit (no model call) →
  buildContext → generate → resolve citations`. Retrieval failure → safe error, no LLM call.
- **Context fix found via live smoke:** the model was emitting the vehicle *display name* in
  `winner_vehicle_id`; the context now shows `[vehicle_id: …]` and the prompt tells the model to
  use it. Comparison answers then validate cleanly.
- **Tests:** 8 offline (retry paths + pipeline short-circuits, fake model/retriever) + a live
  generation smoke (single/comparison/out_of_scope) — **72 total pass**; `typecheck`/`build` clean.

## ✅ Phase 7 — deterministic recommendation engine

The application-side final decision (spec §17) — the LLM assesses evidence, the code picks (§17.8).

- **`constraints.ts`** — deterministic hard-constraint parser (§11.3): `minimum_seats`,
  `allowed_powertrains` (electric/hybrid/gasoline/diesel), `transmission` (automatic/manual).
  Explicit-only, never inferred (§250); budget excluded (§247).
- **`recommend.ts`** — the decision policy: eliminate on `not_satisfied` constraints (missing
  evidence never eliminates, but blocks a confident pick); **lexicographic** on the user's stated
  aspect order; else **Pareto** sole-winner; else an explicit **trade-off** + the model's follow-up.
  No numerical scores, no chunk-counting.
- **Wiring**: `context.ts` renders a `HARD CONSTRAINTS` section so the model emits
  `constraint_assessments`; `answer.ts` parses constraints, passes them through, and attaches a
  `recommendation` to multi-vehicle answers.
- **Prompt tightening** (found via live smoke): a 3-vehicle recommendation overflowed the 1200-token
  cap → the system prompt now caps assessments at 3 aspects (§203) and requires concise explanations
  (§23.3), keeping output within budget.
- **Tests:** 21 offline (parser + the full §18.7 recommendation matrix + context + pipeline) + a
  live constrained-recommendation smoke. **90 total pass**; `typecheck`/`build` clean.

## ✅ Phase 8 — session memory (state model + reducer)

Short-term session memory (spec §16), server-side half. Browser `sessionStorage` + sending state
with each request is Phase 9.

- **`session.ts`** — `SessionState` (active/comparison vehicles, preferences = priorities +
  constraints + usage patterns, two recent turns, per-aspect inferred counters). `emptySession()`
  (new session starts empty), `sanitizeSession()` (server-validates client-sent state: drops
  non-approved vehicles / out-of-enum aspects & usage / caps recent turns — §16.6), `updateSession()`
  (folds one turn: explicit preferences stick immediately and override conflicts; **inferred stick
  only after two turns** §249; constraints explicit-only override; usage-pattern union; last 2 turns).
- **`answer.ts`** — accepts a prior `SessionState`, sanitizes it, uses `activeVehicleIds` for the
  follow-up path, renders preferences into the context, and returns the canonical **updated
  session**. Preference extraction rides on the existing generation call — no extra LLM (§16.5).
- **Tests:** the §18.8 memory matrix (empty start, follow-up carries active vehicles, explicit
  retention, explicit override, one-time question ≠ preference, two-turn inferred rule, usage-enum,
  recent-turns cap, sanitize) + pipeline session tests. **~110 pass**; `typecheck`/`build` clean.
- Also hardened the live recommendation smoke to accept the spec's safe-fallback (a complex
  3-vehicle recommendation can occasionally exceed the 1200-token cap → fallback, which is correct).

## ✅ Phase 9 — user interface (Next.js chat UI)

The online surface (spec §19/§20.1) — the first time every prior phase runs together end-to-end in a
real browser. "Fork and simplify the Vercel template" (§19.1) here means adopting the building blocks
§19.3 keeps (Tailwind, chat layout, loading/error states) without dragging in what §19.4 removes
(auth, DB, uploads, Blob, artifacts, model selector) — none of it is imported in the first place.

- **`web/app/api/chat/route.ts`** — the single online endpoint (§20.1): `POST { message, session }` →
  wraps the existing `answer()` → validated `AnswerResult` JSON. Input validation (non-empty, ≤2000
  chars), request-scoped structured log (§21, no message text/keys), safe error shapes (no stack).
  Secrets and the OpenAI/Qdrant clients stay server-side; `runtime = "nodejs"`.
- **Browser session (§16.2)** — `web/lib/session/clientSession.ts` persists `SessionState` in
  `sessionStorage`, sent with each request; the server-returned canonical state is stored back. The
  server re-runs `sanitizeSession()` inside `answer()`, so a tampered store is harmless. Reset wipes it.
- **Answer is a structured JSON object, not a token stream** — so the route returns JSON and the client
  renders the validated shape (no `useChat` streaming transport); a processing-stage indicator shows
  while awaiting.
- **UI** — `web/components/{Chat,AnswerView,PreferencePanel}.tsx` + `web/lib/ui/labels.ts` (Hebrew
  labels for every locked enum + `vehicleName()` from the shared catalog). Renders overview with inline
  citation chips, aspect/constraint assessments, the deterministic recommendation with a **trade-off**
  badge, missing-information, follow-up, terminal `out_of_scope`/`insufficient_evidence`/`error`
  states, expandable **source cards** (§19.5), and a live **preference panel**. Full RTL + an
  automotive graphite/deep-blue visual identity (Tailwind v4).
- **Verification** — `typecheck`/`build`/`test` (113) green; a **Playwright** e2e drives the §28
  acceptance conversation (4 turns) against a mocked route (CI-safe, §27A) and asserts every DoD
  behavior. A **live run** through the real route (MG S6) returned `status: complete` with 3 citations
  and remembered `mg_s6`; a screenshot confirmed RTL + identity + trade-off + expandable sources.
- Built **Vercel-ready** (§20): server routes only, no local-disk persistence, secrets non-`NEXT_PUBLIC_`
  — so Phase 11 deployment is mostly env wiring.

## ✅ Phase 10 — security + reliability

Hardening at the HTTP boundary (spec §Phase 10). **Much of the DoD was already satisfied by earlier
phases** — timeouts (generation 35s, embedding/Qdrant 10s), one retry + safe fallback, citation
validation, server-side secrets, UNTRUSTED evidence separation, Qdrant-failure→no-LLM, safe errors
with no stack. This phase adds the missing pieces:

- **Rate limiting** — `web/lib/security/rateLimit.ts`: one `RateLimiter` interface with two impls
  behind a factory. **Upstash Redis** (`@upstash/ratelimit`) when `UPSTASH_REDIS_REST_URL/TOKEN` are
  set (durable, shared across serverless instances — the production path); otherwise an **in-memory
  sliding window** singleton (per-instance, POC-safe). Client id = HMAC-SHA256 of the forwarded IP
  with `RATE_LIMIT_SECRET` — the raw IP is never stored/logged (§21.4). Route returns **429** +
  `Retry-After` before any pipeline work. 20 req / 60s.
- **Health endpoint** — `web/app/api/health/route.ts`: `GET` → `{ status, checks: { openai, qdrant } }`,
  booleans of env *presence* only (never values), no external/paid calls, no secrets/stack.
- **Structured logs** (§21.3) — `answer()` returns a compact `trace` (`web/lib/observability/trace.ts`:
  route, vehicle/chunk counts, retries, recommendation rule, status); the route logs one JSON line with
  `latencyMs`, excluding message text / keys / raw chunks (§21.4). `generateAnswer` now reports `attempts`.
- **Input hardening** — only `message` (non-empty, ≤2000) and an object `session` are read; extra body
  fields (e.g. a raw Qdrant `filter`) are inert — a user can never inject a retrieval filter.
- **Tests** — 6 rate-limiter units (limit/window/isolation/factory/hashing) + a security e2e
  (`/api/health` presence-only; invalid-input 400 ignores a stray `filter`). **119 unit + 6 e2e pass.**
- **Live-verified** on the running server: health `{openai:true,qdrant:true}`; 20×400 then **429**
  (zero paid calls — empty messages are counted then validation-rejected); a real turn emitted the
  structured trace line (`route:single, chunkCount:5, retries:0, latencyMs, status:complete`).

**Rate-limit note:** the earlier Upstash blocker is resolved by the pluggable fallback — the app runs
now without Upstash keys (in-memory) and upgrades automatically when the keys are added (recommended
before Vercel, since serverless makes in-memory per-instance).

## Open flags / dependencies

- ✅ **OpenAI key** available (in git-ignored `.env`).
- ✅ **Qdrant Cloud key** available; Phase 3b index is live. **Upstash keys** absent but **no longer a
  blocker** — Phase 10 rate limiting falls back to in-memory; add the keys before Vercel for durable,
  cross-instance limiting.
- ✅ **`gpt-5.6-terra` verified live** (real model on the account; Responses API works).
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
| #9 | Phase 5a — web bootstrap + deterministic vehicle resolver | Merged |
| #10 | Phase 5b — live retrieval orchestrator (routes + balanced evidence) | Merged |
| #11 | Phase 6a — context builder + citation map + generation schema | Merged |
| #12 | Phase 6b — live structured generation + answer pipeline | Merged |
| #13 | Phase 7 — deterministic recommendation engine | Merged |
| #14 | Witty rotating out-of-scope message | Merged |
| #15 | Phase 8 — session memory (state model + reducer) | Merged |
| #16 | Phase 9 — Next.js chat UI (route + client + §28 e2e) | Merged |
| #17 | Rotating "thinking" messages | Merged |
| #18 | Phase 10 — security + reliability (rate limit, health, logs) | Merged |
| #19 | Phase 11 prep — Node pin + Vercel deploy guide | Open |
