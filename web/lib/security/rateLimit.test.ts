import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, RATE_LIMIT, clientId, createRateLimiter } from "./rateLimit";

describe("InMemoryRateLimiter", () => {
  it("allows up to the limit then blocks", async () => {
    const rl = new InMemoryRateLimiter(() => 1000);
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect((await rl.check("a")).allowed).toBe(true);
    }
    const blocked = await rl.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(0);
  });

  it("frees up after the window elapses", async () => {
    let now = 1000;
    const rl = new InMemoryRateLimiter(() => now);
    for (let i = 0; i < RATE_LIMIT; i += 1) await rl.check("a");
    expect((await rl.check("a")).allowed).toBe(false);
    now += 60_001; // step past the 60s window
    expect((await rl.check("a")).allowed).toBe(true);
  });

  it("tracks identifiers independently", async () => {
    const rl = new InMemoryRateLimiter(() => 1000);
    for (let i = 0; i < RATE_LIMIT; i += 1) await rl.check("a");
    expect((await rl.check("a")).allowed).toBe(false);
    expect((await rl.check("b")).allowed).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("falls back to in-memory when Upstash is not configured", () => {
    expect(createRateLimiter({})).toBeInstanceOf(InMemoryRateLimiter);
  });
});

describe("clientId", () => {
  const env = { RATE_LIMIT_SECRET: "s" };

  it("is deterministic and never contains the raw IP", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    const a = clientId(headers, env);
    expect(clientId(headers, env)).toBe(a);
    expect(a).not.toContain("203.0.113.5");
    expect(a).toHaveLength(32);
  });

  it("differs per IP and per secret", () => {
    const h1 = new Headers({ "x-forwarded-for": "1.1.1.1" });
    const h2 = new Headers({ "x-forwarded-for": "2.2.2.2" });
    expect(clientId(h1, env)).not.toBe(clientId(h2, env));
    expect(clientId(h1, env)).not.toBe(clientId(h1, { RATE_LIMIT_SECRET: "t" }));
  });
});
