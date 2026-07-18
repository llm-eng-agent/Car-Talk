# Deploying Car-Talk to Vercel (Phase 11)

The online app is a single Next.js project in [`web/`](../web). The offline pipeline (`pipeline/`)
is **not** deployed — the Qdrant Cloud index it produced persists independently, so a frontend
redeploy never touches the data (spec §20.6).

Deployment is via the **Vercel Dashboard + GitHub integration**: every push to `main` auto-deploys,
and each PR gets a preview URL. No tokens are shared.

## One-time setup

1. **Sign in** at [vercel.com](https://vercel.com) (GitHub sign-in is easiest).
2. **Add New… → Project** → **Import** the `Car-Talk` GitHub repo (authorize Vercel for the repo).
3. **Root Directory → `web`** — this is required; the app lives in the subdirectory, not the repo
   root. Framework is auto-detected as **Next.js**; install/build use pnpm (from the committed
   `pnpm-lock.yaml`).
4. **Environment Variables** (scope: Production **and** Preview) — server-side only, **never** with a
   `NEXT_PUBLIC_` prefix (spec §20.5):

   | Variable | Required | Value |
   |---|---|---|
   | `OPENAI_API_KEY` | ✅ | OpenAI key (embeddings + generation) |
   | `QDRANT_URL` | ✅ | Qdrant Cloud cluster URL |
   | `QDRANT_API_KEY` | ✅ | Qdrant Cloud API key |
   | `QDRANT_COLLECTION` | ✅ | `car_review_chunks_v1` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | ✅ | `1` — makes the `packageManager` pin effective (see below) |
   | `RATE_LIMIT_SECRET` | ✅ | random string, e.g. `openssl rand -hex 32` (HMAC key for IP hashing) |
   | `UPSTASH_REDIS_REST_URL` | ⭕ recommended | Upstash Redis REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | ⭕ recommended | Upstash Redis REST token |

   Set a real `RATE_LIMIT_SECRET` — without it the IP-hashing key falls back to a public default, so
   the rate-limit identifiers are no longer private. This matters most with Upstash, where those
   identifiers are persisted server-side.

   Without the Upstash pair the rate limiter falls back to in-memory (per-instance). On serverless
   that is weak protection across instances — add Upstash for durable, shared limiting.
5. **Deploy.** Vercel builds `web/` and returns a public URL `https://<project>.vercel.app`.

## Notes

- **Function duration:** a slow grounded generation can take ~35s, so the chat route sets
  `maxDuration = 60` ([web/app/api/chat/route.ts](../web/app/api/chat/route.ts)). Ensure the Vercel
  plan permits up to 60s; the internal timeouts (generation 35s, embedding/Qdrant 10s) keep requests
  under that ceiling.
- **No scraping/indexing at deploy** — Vercel only builds the Next.js app. Re-indexing is a manual
  offline job (`pipeline/`), run separately against Qdrant Cloud.
- **Node** is pinned to 22.x via `engines` (spec §27A).
- **pnpm version:** `web/package.json` pins `packageManager: pnpm@10.32.1`, but Vercel only honors that
  field **when Corepack is enabled**. Otherwise it infers the pnpm major from the lockfile version
  (`pnpm-lock.yaml` is v9 → pnpm 9 or 10). Set **`ENABLE_EXPERIMENTAL_COREPACK=1`** (above) so the pin
  is enforced and the build matches the verified local environment. See
  [Vercel package managers](https://vercel.com/docs/package-managers).

## Verify after deploy (DoD §Phase 11)

1. Open `https://<url>/` — the welcome screen renders (RTL, automotive identity).
2. `GET https://<url>/api/health` → `200` with `{"status":"ok","checks":{"openai":true,"qdrant":true}}`
   (presence only — no secret values).
3. Run the §28 acceptance conversation in the browser:
   - "אני מחפש רכב משפחתי לשלושה ילדים. נוחות ומרחב חשובים לי יותר מביצועים." → priorities stored + candidates.
   - "השווה בין ה-EV9 ל-GV80." → balanced comparison, no universal winner.
   - "ומה לגבי הנוחות שלהם בנסיעות ארוכות?" → remembers both vehicles + priority order.
   - "מי מהם אמין יותר אחרי חמש שנים?" → "insufficient evidence", no fabrication.
4. Confirm: deploy did not scrape/reindex; Qdrant data persists independently; `QDRANT_COLLECTION`
   is env-controlled; a frontend redeploy leaves the index unchanged.
