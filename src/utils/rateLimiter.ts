interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitEntry>();

/** Periodically drop expired buckets so memory stays bounded. */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(key);
  }
}, 60_000).unref?.();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true };
}

export function messageRateLimitKey(userId: string): string {
  return `message:${userId}`;
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Express middleware factory for IP-based rate limits. */
export function rateLimitMiddleware(options: {
  keyPrefix: string;
  max: number;
  windowMs: number;
  message?: string;
}) {
  const { keyPrefix, max, windowMs, message = 'Too many requests, try again later' } = options;
  return (req: any, res: any, next: any) => {
    const result = checkRateLimit(`${keyPrefix}:${clientIp(req)}`, max, windowMs);
    if (!result.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((result.retryAfterMs || windowMs) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message, retryAfterSec });
    }
    return next();
  };
}
