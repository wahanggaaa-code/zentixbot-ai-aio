// Fixed-window per-key rate limits. Entries are retained until their window has
// expired; at capacity we reject new keys rather than evict an active limit.
import { logger } from './logger.js';

export const RATE_LIMIT_MAX_ENTRIES = 50_000;
const SWEEP_INTERVAL_MS = 60_000;

export function createRateLimiter({ maxEntries = RATE_LIMIT_MAX_ENTRIES, now = Date.now } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer');
  const store = new Map();
  let nextCapacitySweep = 0;

  function sweep() {
    const time = now();
    nextCapacitySweep = time + 1000;
    let removed = 0;
    for (const [key, entry] of store) {
      // Preserve the original strict boundary (elapsed > windowMs).
      if (time - entry.windowStart > entry.retentionMs) { store.delete(key); removed++; }
    }
    return removed;
  }

  function status(key, windowMs = 60000) {
    let entry = store.get(key);
    if (!entry && store.size >= maxEntries) {
      if (now() >= nextCapacitySweep) sweep();
      // Callers such as giveaway check status before recording an attempt.
      // Do not report an unused key as unrestricted when the store is full.
      if (store.size >= maxEntries) return { limited: true, remaining: windowMs, attempts: 1 };
    }
    if (!entry) return { limited: false, remaining: windowMs };
    entry.retentionMs = Math.max(entry.retentionMs, windowMs);
    const remaining = Math.max(0, windowMs - (now() - entry.windowStart));
    return { limited: remaining > 0, remaining, attempts: entry.count };
  }

  async function check(key, maxAttempts = 5, windowMs = 60000) {
    try {
      const time = now();
      let entry = store.get(key);
      if (!entry || time - entry.windowStart > windowMs) {
        if (!entry && store.size >= maxEntries) {
          if (time >= nextCapacitySweep) sweep();
          if (store.size >= maxEntries) return false;
        }
        store.set(key, { count: 1, windowStart: time, retentionMs: windowMs });
        return true;
      }
      entry.retentionMs = Math.max(entry.retentionMs, windowMs);
      if (entry.count < maxAttempts) { entry.count++; return true; }
      logger.debug(`Rate limit exceeded for ${key}`);
      return false;
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      return false;
    }
  }

  return { check, status, sweep, delete: key => store.delete(key), clear: () => store.clear(), get size() { return store.size; } };
}

const limiter = createRateLimiter();
const timer = setInterval(() => limiter.sweep(), SWEEP_INTERVAL_MS);
timer.unref?.();

export function getRateLimiterMemoryStats() { return { size: limiter.size, maxEntries: RATE_LIMIT_MAX_ENTRIES }; }
export const checkRateLimit = (...args) => limiter.check(...args);
export const getRateLimitStatus = (...args) => limiter.status(...args);
export function clearRateLimit(key) { limiter.delete(key); }
export function clearAllRateLimits() { limiter.clear(); logger.info('All rate limits cleared'); }
