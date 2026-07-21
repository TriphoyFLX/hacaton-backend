import { NextFunction, Request, Response } from 'express';
export declare function getAllowedOrigins(): string[];
export declare function corsOptions(): {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void;
    credentials: boolean;
    methods: string[];
    allowedHeaders: string[];
    maxAge: number;
};
export declare function securityHeaders(_req: Request, res: Response, next: NextFunction): void;
export declare function requireJwtSecret(): string;
//# sourceMappingURL=security.d.ts.map