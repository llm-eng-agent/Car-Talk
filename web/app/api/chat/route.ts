// The single online endpoint (spec §20.1): user message + prior session → the full grounded
// answer pipeline → validated JSON. All secrets and the OpenAI/Qdrant clients live here on the
// server; nothing sensitive reaches the browser. The heavy lifting is `answer()`; this route only
// validates input, delegates, and emits a request-scoped structured log (§21).
import { answer } from "@/lib/generation/answer";
import { type SessionState } from "@/lib/generation/session";

// The pipeline uses the Node OpenAI + Qdrant SDKs, so this route cannot run on the Edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 2000; // input-length guard (§Phase 10: input validation)

interface ChatRequestBody {
  message?: unknown;
  session?: SessionState; // sanitized server-side inside answer() (§16.6) — never trusted as-is
}

export async function POST(request: Request): Promise<Response> {
  const requestId = `req_${crypto.randomUUID().slice(0, 8)}`;

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0) {
    return json({ error: "empty_message" }, 400);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: "message_too_long" }, 413);
  }

  try {
    const result = await answer(message, body.session);
    log({ requestId, status: result.status, mode: result.mode, messageLength: message.length });
    return json(result, 200);
  } catch {
    // Any unexpected failure returns a safe shape — never a stack trace (§Phase 10 / §21.4).
    log({ requestId, status: "error", mode: null, messageLength: message.length });
    return json({ error: "internal_error" }, 500);
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Request-scoped structured log (§21.2/§21.3). Deliberately excludes the message text, keys, and
// raw provider responses (§21.4) — only length and outcome.
function log(entry: {
  requestId: string;
  status: string;
  mode: string | null;
  messageLength: number;
}): void {
  console.log(JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
}
