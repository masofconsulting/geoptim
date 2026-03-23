// SECURITY FIX: in-memory rate limiter per IP (sliding window)
// Covers most abuse scenarios. Resets on cold start — acceptable trade-off.

const buckets = new Map();

// Clean expired entries every 60s to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of buckets) {
    const valid = entries.filter(t => now - t < 60000);
    if (valid.length === 0) buckets.delete(key);
    else buckets.set(key, valid);
  }
}, 60000).unref?.();

/**
 * @param {object} event - Netlify function event
 * @param {number} maxPerMinute - Max requests per IP per 60s window
 * @returns {object|null} - 429 response if rate limited, null if OK
 */
function checkRateLimit(event, maxPerMinute) {
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
          || event.headers['client-ip']
          || 'unknown';
  const now = Date.now();
  const key = ip;

  if (!buckets.has(key)) buckets.set(key, []);
  const entries = buckets.get(key).filter(t => now - t < 60000);
  entries.push(now);
  buckets.set(key, entries);

  if (entries.length > maxPerMinute) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Trop de requêtes. Réessayez dans 1 minute.' })
    };
  }
  return null;
}

module.exports = { checkRateLimit };
