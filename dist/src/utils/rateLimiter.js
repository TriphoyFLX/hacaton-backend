"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
exports.messageRateLimitKey = messageRateLimitKey;
const buckets = new Map();
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
//# sourceMappingURL=rateLimiter.js.map