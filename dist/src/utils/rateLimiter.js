"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
exports.messageRateLimitKey = messageRateLimitKey;
exports.clientIp = clientIp;
exports.rateLimitMiddleware = rateLimitMiddleware;
const buckets = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
        if (now >= entry.resetAt)
            buckets.delete(key);
    }
}, 60000).unref?.();
function checkRateLimit(key, maxRequests, windowMs) {
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
function messageRateLimitKey(userId) {
    return `message:${userId}`;
}
function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
}
function rateLimitMiddleware(options) {
    const { keyPrefix, max, windowMs, message = 'Too many requests, try again later' } = options;
    return (req, res, next) => {
        const result = checkRateLimit(`${keyPrefix}:${clientIp(req)}`, max, windowMs);
        if (!result.allowed) {
            const retryAfterSec = Math.max(1, Math.ceil((result.retryAfterMs || windowMs) / 1000));
            res.setHeader('Retry-After', String(retryAfterSec));
            return res.status(429).json({ error: message, retryAfterSec });
        }
        return next();
    };
}
//# sourceMappingURL=rateLimiter.js.map