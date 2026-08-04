import { createHash, timingSafeEqual } from "node:crypto";

const buckets = new Map();

export function safeSecretEqual(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function stablePrivateToken(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
}

export function setPrivateResponseHeaders(res) {
  res.setHeader?.("Cache-Control", "private, no-store, max-age=0");
  res.setHeader?.("Pragma", "no-cache");
  res.setHeader?.("X-Content-Type-Options", "nosniff");
}

function clientKey(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "unknown");
}

// Best-effort per-instance protection for accidental/repeated expensive calls.
// Serverless instances do not share this map; platform/WAF rate limits remain
// the authoritative distributed control.
export function checkRateLimit(req, { scope, limit, windowMs }) {
  const now = Date.now();
  const key = `${scope}:${clientKey(req)}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 2000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
