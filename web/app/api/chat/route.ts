// The single online endpoint (spec §20.1): user message + prior session → the full grounded answer
// pipeline → validated JSON. All secrets and the OpenAI/Qdrant clients live here on the server;
// nothing sensitive reaches the browser. This route validates input, rate-limits by client, delegates
// to answer(), and emits a request-scoped structured log (spec §21).
import { answer } from "@/lib/generation/answer";
import { type SessionState } from "@/lib/generation/session";
import { clientId, getRateLimiter, safeCheck } from "@/lib/security/rateLimit";

// The pipeline uses the Node OpenAI + Qdrant SDKs, so this route cannot run on the Edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 2000; // input-length guard (§Phase 10: input validation)

interface ChatRequestBody {
  message?: unknown;
  session?: unknown; // sanitized server-side inside answer() (§16.6) — never trusted as-is
}

export async function POST(request: Request): Promise<Response> {
  const requestId = `req_${crypto.randomUUID().slice(0, 8)}`;

  // Rate limit before doing any work (§Phase 10). The identifier is a hash of the client IP.
  // safeCheck fails open on a limiter outage so the rate-limit dependency can never take chat down.
  const { result: limit, error: limiterError } = await safeCheck(getRateLimiter(), clientId(request.headers));
  if (limiterError) log({ requestId, event: "rate_limiter_error" });
  if (!limit.allowed) {
    log({ requestId, event: "rate_limited" });
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(Math.ceil(limit.resetMs / 1000)),
      },
    });
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0) return json({ error: "empty_message" }, 400);
  if (message.length > MAX_MESSAGE_CHARS) return json({ error: "message_too_long" }, 413);

  // Only an object session is passed through; anything else is dropped (answer() re-sanitizes). Extra
  // top-level fields (e.g. a raw Qdrant `filter`) are ignored — the client can never reach retrieval.
  const session =
    body.session && typeof body.session === "object" ? (body.session as SessionState) : undefined;

  try {
    const started = Date.now();
    const result = await answer(message, session);
    log({ requestId, messageLength: message.length, latencyMs: Date.now() - started, ...(result.trace ?? { status: result.status }) });
    return json(result, 200);
  } catch {
    // Any unexpected failure returns a safe shape — never a stack trace (§Phase 10 / §21.4).
    log({ requestId, status: "error", messageLength: message.length });
    return json({ error: "internal_error" }, 500);
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Request-scoped structured log (§21.2/§21.3). Excludes the message text, keys, and raw provider
// responses (§21.4) — only lengths, the trace summary, and the outcome.
function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
}
