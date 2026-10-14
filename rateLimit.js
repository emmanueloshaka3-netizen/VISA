// Simple in-memory fixed-window rate limiter. Good enough for a single
// free-tier instance; swap for a shared store if the app scales to
// multiple instances.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20; // per IP per window, chat endpoint only

const hits = new Map(); // ip -> { count, resetAt }

function allow(ip) {
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }
  rec.count += 1;
  if (hits.size > 5000) { // basic memory guard
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }
  return { ok: rec.count <= MAX_REQUESTS, retryAfterMs: rec.resetAt - now };
}

module.exports = { allow, WINDOW_MS, MAX_REQUESTS };
