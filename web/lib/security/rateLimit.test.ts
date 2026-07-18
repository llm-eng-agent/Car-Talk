import { describe, expect, it, vi } from "vitest";
import { InMemoryRateLimiter, RATE_LIMIT, clientId, createRateLimiter, safeCheck } from "./rateLimit";

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

  it("warns when Upstash is configured without RATE_LIMIT_SECRET", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The warn fires before the Upstash client is built; the fake creds make that build throw, which
    // is irrelevant to what we assert here — swallow it.
    const upstashEnv = { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };
    try {
      createRateLimiter(upstashEnv);
    } catch {}
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("rate_limit_secret_missing");

    warn.mockClear();
    try {
      createRateLimiter({ ...upstashEnv, RATE_LIMIT_SECRET: "s" });
    } catch {}
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("clientId", () => {
  const env = { RATE_LIMIT_SECRET: "s" };

  it("is deterministic and never contains the raw IP", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.5" });
    const a = clientId(headers, env);
    expect(clientId(headers, env)).toBe(a);
    expect(a).not.toContain("203.0.113.5");
    expect(a).toHaveLength(32);
  });

  it("differs per IP and per secret", () => {
    const h1 = new Headers({ "x-real-ip": "1.1.1.1" });
    const h2 = new Headers({ "x-real-ip": "2.2.2.2" });
    expect(clientId(h1, env)).not.toBe(clientId(h2, env));
    expect(clientId(h1, env)).not.toBe(clientId(h1, { RATE_LIMIT_SECRET: "t" }));
  });

  it("does NOT trust client-controllable x-forwarded-for", () => {
    // A client that spoofs x-forwarded-for gets the shared bucket, not a fresh per-IP one.
    const spoofed = new Headers({ "x-forwarded-for": "9.9.9.9" });
    const none = new Headers();
    expect(clientId(spoofed, env)).toBe(clientId(none, env));
  });
});

describe("safeCheck", () => {
  it("fails open when the limiter throws (outage cannot take chat down)", async () => {
    const throwing = {
      check: async () => {
        throw new Error("redis down");
      },
    };
    const { result, error } = await safeCheck(throwing, "id");
    expect(result.allowed).toBe(true);
    expect(error).toBe(true);
  });

  it("passes a healthy limiter's result through unchanged", async () => {
    const limiter = new InMemoryRateLimiter(() => 1000);
    const { result, error } = await safeCheck(limiter, "id");
    expect(result.allowed).toBe(true);
    expect(error).toBe(false);
  });
});
