export declare function checkRateLimit(key: string, maxRequests: number, windowMs: number): {
    allowed: boolean;
    retryAfterMs?: number;
};
export declare function messageRateLimitKey(userId: string): string;
export declare function clientIp(req: {
    ip?: string;
    headers: Record<string, unknown>;
    socket?: {
        remoteAddress?: string;
    };
}): string;
export declare function rateLimitMiddleware(options: {
    keyPrefix: string;
    max: number;
    windowMs: number;
    message?: string;
}): (req: any, res: any, next: any) => any;
//# sourceMappingURL=rateLimiter.d.ts.map