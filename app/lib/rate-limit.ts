// app/lib/rate-limit.ts
// Per-IP rate limiting for public / cost-bearing API routes.
//
// Backend selection:
//   - Upstash Redis (via @upstash/ratelimit) when KV_REST_API_URL and
//     KV_REST_API_TOKEN are set. These are the same env vars @vercel/kv uses
//     in app/api/lib/cache.ts, so no new configuration is needed in prod.
//   - Otherwise a best-effort in-memory fixed-window limiter. This is only
//     per-instance (each serverless instance / cold start has its own counters),
//     so it is a speed bump for local dev and preview, not a hard guarantee.
//
// If Redis errors at runtime we fail OPEN (allow the request) and log, so an
// Upstash outage can never take the site down.
//
// Usage in a route:
//   const limited = await enforceRateLimit(req, "suggestions")
//   if (limited) return limited
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import { NextResponse } from "next/server";

export interface RateLimitRule {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

/** Named limits. Keep these generous: many members share NAT'd IPs at events. */
export const RATE_LIMITS = {
  suggestions: { limit: 5, windowSec: 10 * 60 },
  "suggestions-upload": { limit: 10, windowSec: 10 * 60 },
  "city-autocomplete": { limit: 60, windowSec: 60 },
  "city-region": { limit: 20, windowSec: 60 },
  namegen: { limit: 30, windowSec: 60 },
  "magic-login": { limit: 5, windowSec: 15 * 60 },
  "vote-anonymous": { limit: 60, windowSec: 10 * 60 },
  // Per member (keyed by Discord id, not IP): plans/mission-verification.md §6.3.
  "missions-check": { limit: 1, windowSec: 30 },
  "missions-check-daily": { limit: 30, windowSec: 24 * 60 * 60 },
  "missions-command": { limit: 1, windowSec: 60 },
  "missions-submit": { limit: 10, windowSec: 60 * 60 },
  "missions-bulk-review": { limit: 20, windowSec: 60 * 60 },
  "referral-search": { limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  reset: number;
}

/**
 * Client IP from the proxy headers. On Vercel, x-forwarded-for is set by the
 * platform (client-supplied values are overwritten), so its first value is the
 * real client IP.
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

/** Hash the IP so raw addresses never land in Redis keys. */
function ipKey(ip: string): string {
  return createHash("sha256").update(`rl:${ip}`).digest("hex").slice(0, 32);
}

export function isUpstashConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// ---------------------------------------------------------------------------
// In-memory fallback (best effort, per instance)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, { count: number; resetAt: number }>();
const MEMORY_MAX_KEYS = 10_000;

function pruneMemoryStore(now: number) {
  for (const [k, v] of memoryStore) {
    if (v.resetAt <= now) memoryStore.delete(k);
  }
  // Still too big (e.g. under a spray of unique IPs): drop oldest entries.
  if (memoryStore.size > MEMORY_MAX_KEYS) {
    const excess = memoryStore.size - MEMORY_MAX_KEYS;
    let i = 0;
    for (const k of memoryStore.keys()) {
      if (i++ >= excess) break;
      memoryStore.delete(k);
    }
  }
}

export function memoryLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  if (memoryStore.size > MEMORY_MAX_KEYS) pruneMemoryStore(now);

  let entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + rule.windowSec * 1000 };
    memoryStore.set(key, entry);
  }
  entry.count += 1;
  return {
    success: entry.count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - entry.count),
    reset: entry.resetAt,
  };
}

/** Test helper: clear the in-memory counters. */
export function __resetMemoryRateLimits() {
  memoryStore.clear();
  upstashLimiters.clear();
}

// ---------------------------------------------------------------------------
// Upstash backend
// ---------------------------------------------------------------------------

const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(name: string, rule: RateLimitRule): Ratelimit {
  const cacheKey = `${name}:${rule.limit}:${rule.windowSec}`;
  let limiter = upstashLimiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: new Redis({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSec} s`),
      prefix: `ratelimit:${name}`,
      analytics: false,
    });
    upstashLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check (and consume) one request against the named limit for this client IP. */
export async function checkRateLimit(
  req: Request,
  name: RateLimitName,
  rule: RateLimitRule = RATE_LIMITS[name],
): Promise<RateLimitResult> {
  const id = ipKey(getClientIp(req.headers));

  if (isUpstashConfigured()) {
    try {
      const r = await getUpstashLimiter(name, rule).limit(id);
      return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
    } catch (e) {
      // Fail open: never block real users because Redis is unavailable.
      console.error(`[rate-limit] Upstash error for ${name}, allowing request:`, e);
      return { success: true, limit: rule.limit, remaining: rule.limit, reset: Date.now() };
    }
  }

  return memoryLimit(`${name}:${id}`, rule);
}

/**
 * Check (and consume) one request against the named limit for an arbitrary
 * key, e.g. a Discord id for per-member limits. The key is hashed like IPs.
 */
export async function checkKeyedRateLimit(
  name: RateLimitName,
  key: string,
  rule: RateLimitRule = RATE_LIMITS[name],
): Promise<RateLimitResult> {
  const id = ipKey(`key:${key}`);
  if (isUpstashConfigured()) {
    try {
      const r = await getUpstashLimiter(name, rule).limit(id);
      return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
    } catch (e) {
      console.error(`[rate-limit] Upstash error for ${name}, allowing request:`, e);
      return { success: true, limit: rule.limit, remaining: rule.limit, reset: Date.now() };
    }
  }
  return memoryLimit(`${name}:${id}`, rule);
}

/** Build the standard 429 response with Retry-After. */
export function rateLimitResponse(result: RateLimitResult, now = Date.now()): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((result.reset - now) / 1000));
  return NextResponse.json(
    {
      error: "Too many requests. Please slow down and try again shortly.",
      code: "RATE_LIMITED",
      status: "rate_limited", // MagicLoginFlow keys its error copy off `status`
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
      },
    },
  );
}

/**
 * Returns a 429 NextResponse if the client is over the limit, otherwise null.
 */
export async function enforceRateLimit(
  req: Request,
  name: RateLimitName,
  rule?: RateLimitRule,
): Promise<NextResponse | null> {
  const result = await checkRateLimit(req, name, rule);
  return result.success ? null : rateLimitResponse(result);
}
