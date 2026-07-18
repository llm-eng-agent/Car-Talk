// Rate limiting (spec §Phase 10). Pluggable: Upstash Redis when its env is configured (durable and
// shared across serverless instances — the production path), otherwise an in-memory sliding window
// (per-instance, resets on cold start — a POC-safe fallback). The client identifier is an HMAC of
// the forwarded IP so the raw IP is never stored or logged (spec §21.4 / .env RATE_LIMIT_SECRET).
import crypto from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const RATE_LIMIT = 20; // requests
export const RATE_WINDOW_MS = 60_000; // per 60s window

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number; // ms until the window frees up
}

export interface RateLimiter {
  check(id: string): Promise<RateLimitResult>;
}

// Sliding window kept in process memory. A clock is injected so tests are deterministic.
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async check(id: string): Promise<RateLimitResult> {
    const t = this.now();
    const windowStart = t - RATE_WINDOW_MS;
    const recent = (this.hits.get(id) ?? []).filter((ts) => ts > windowStart);
    if (recent.length >= RATE_LIMIT) {
      this.hits.set(id, recent);
      return { allowed: false, remaining: 0, resetMs: Math.max(0, recent[0] + RATE_WINDOW_MS - t) };
    }
    recent.push(t);
    this.hits.set(id, recent);
    return { allowed: true, remaining: RATE_LIMIT - recent.length, resetMs: RATE_WINDOW_MS };
  }
}

class UpstashRateLimiter implements RateLimiter {
  private readonly limiter: Ratelimit;

  constructor(url: string, token: string) {
    this.limiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(RATE_LIMIT, `${RATE_WINDOW_MS / 1000} s`),
      prefix: "car-talk:rl",
      timeout: 2000, // if Redis is slow/unreachable, fail open after 2s rather than stall the request
    });
  }

  async check(id: string): Promise<RateLimitResult> {
    const r = await this.limiter.limit(id);
    return { allowed: r.success, remaining: r.remaining, resetMs: Math.max(0, r.reset - Date.now()) };
  }
}

// Chooses Upstash when configured, else the in-memory fallback. Exported for tests; the route uses
// the cached singleton below so the in-memory store persists across requests in one instance.
export function createRateLimiter(env: Record<string, string | undefined> = process.env): RateLimiter {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    // With Upstash the hashed identifiers are persisted server-side. Without a real RATE_LIMIT_SECRET,
    // clientId() hashes IPs with a public default key — flag it loudly rather than fail silently
    // (we don't throw, to stay fail-open). Set RATE_LIMIT_SECRET in production.
    if (!env.RATE_LIMIT_SECRET?.trim()) {
      console.warn(
        JSON.stringify({
          event: "rate_limit_secret_missing",
          message: "Upstash is configured but RATE_LIMIT_SECRET is unset; IP hashes use a public default key.",
        }),
      );
    }
    return new UpstashRateLimiter(url, token);
  }
  return new InMemoryRateLimiter();
}

let cached: RateLimiter | undefined;
export function getRateLimiter(): RateLimiter {
  cached ??= createRateLimiter();
  return cached;
}

// Runs a limit check that can never take the route down. If the limiter throws (e.g. an Upstash
// Redis outage / bad token / timeout), we FAIL OPEN — availability over strict limiting — and flag
// the error so the caller can log it. The route must call this rather than limiter.check() directly.
export async function safeCheck(
  limiter: RateLimiter,
  id: string,
): Promise<{ result: RateLimitResult; error: boolean }> {
  try {
    return { result: await limiter.check(id), error: false };
  } catch {
    return { result: { allowed: true, remaining: RATE_LIMIT, resetMs: 0 }, error: true };
  }
}

// A stable, non-reversible per-client id: HMAC-SHA256 of the client IP. The raw IP is never stored.
// The IP comes ONLY from `x-real-ip`, which the hosting platform (Vercel) sets from the real
// connection and overwrites any client-supplied value — so a client cannot forge a fresh bucket by
// sending its own `x-forwarded-for` (whose leftmost value is client-controllable). Behind a
// different proxy, configure it to set `x-real-ip` to the true client IP. No IP → one shared bucket.
export function clientId(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const ip = headers.get("x-real-ip")?.trim() || "shared";
  const secret = env.RATE_LIMIT_SECRET?.trim() || "car-talk-dev-secret";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}
