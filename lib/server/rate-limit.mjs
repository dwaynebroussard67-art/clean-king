/**
 * Simple in-memory rate limiter for onboarding operations.
 * Per-tenant, per-action-type sliding window.
 * Not production-grade (single-process memory) but testable and safe;
 * replace with Redis or database-backed limiting before real traffic.
 */

const windows = new Map(); // key -> { count, resetAt }

const WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX = 10; // 10 requests per minute per tenant per action

function windowKey(tenantId, action) {
  return `${tenantId}:${action}`;
}

/** Check if a request is allowed under the rate limit. Returns { ok, remaining, resetAt }. */
export function rateLimitCheck(tenantId, action, { max = DEFAULT_MAX, now = Date.now } = {}) {
  const key = windowKey(tenantId, action);
  const entry = windows.get(key);
  const current = now();

  if (!entry || current >= entry.resetAt) {
    // New window
    windows.set(key, { count: 1, resetAt: current + WINDOW_MS });
    return { ok: true, remaining: max - 1, resetAt: current + WINDOW_MS };
  }

  if (entry.count >= max) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { ok: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

/** Record a consumed rate-limit token (for idempotent retries). */
export function rateLimitConsume(tenantId, action, { now = Date.now } = {}) {
  const key = windowKey(tenantId, action);
  const entry = windows.get(key);
  if (entry && now() < entry.resetAt) {
    entry.count += 1;
  }
}

/** Clear all rate-limit state (for testing). */
export function rateLimitClear() {
  windows.clear();
}