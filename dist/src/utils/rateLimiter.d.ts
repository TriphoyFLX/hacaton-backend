export declare function checkRateLimit(key: string, maxRequests: number, windowMs: number): {
    allowed: boolean;
    retryAfterMs?: number;
};
export declare function messageRateLimitKey(userId: string): string;
//# sourceMappingURL=rateLimiter.d.ts.map