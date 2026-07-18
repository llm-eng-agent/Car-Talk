// Liveness/readiness probe (spec §Phase 10/§21). Reports only whether each required secret is
// *present* — never its value — so it is safe to expose publicly. No external calls (no paid Qdrant
// ping), no stack traces, no secrets.
export const runtime = "nodejs";

export function GET(): Response {
  const checks = {
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    qdrant: Boolean(process.env.QDRANT_URL?.trim() && process.env.QDRANT_API_KEY?.trim()),
  };
  return new Response(JSON.stringify({ status: "ok", checks, time: new Date().toISOString() }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
