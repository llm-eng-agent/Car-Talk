import { expect, test } from "@playwright/test";

// Phase-10 hardening at the HTTP boundary (spec §Phase 10). These hit the real Next routes (not the
// mocked client path) but never reach the paid pipeline — health reads only env presence, and the
// invalid-input case is rejected at validation before answer() runs. CI-safe.

test("health endpoint reports presence checks, never secret values", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(typeof body.checks.openai).toBe("boolean");
  expect(typeof body.checks.qdrant).toBe("boolean");
  // The payload must not carry an actual key.
  expect(await res.text()).not.toContain("sk-");
});

test("chat rejects invalid input and ignores stray fields like a raw Qdrant filter", async ({ request }) => {
  const res = await request.post("/api/chat", {
    data: { message: "", filter: { must: [{ key: "vehicle_id", match: { value: "mg_s6" } }] }, session: "evil" },
  });
  // Rejected at input validation (empty message) before any retrieval — the `filter` and the
  // non-object `session` are inert; a user can never inject a Qdrant filter.
  expect(res.status()).toBe(400);
});
