"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllowedOrigins = getAllowedOrigins;
exports.corsOptions = corsOptions;
exports.securityHeaders = securityHeaders;
exports.requireJwtSecret = requireJwtSecret;
const DEFAULT_ORIGINS = ['https://soundlab-studio.ru', 'https://www.soundlab-studio.ru'];
function getAllowedOrigins() {
    const fromEnv = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const origins = [...new Set([...fromEnv, ...DEFAULT_ORIGINS])];
    if (process.env.NODE_ENV !== 'production') {
        origins.push('http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173');
    }
    return origins;
}
function corsOptions() {
    const allowed = getAllowedOrigins();
    return {
        origin(origin, callback) {
            if (!origin)
                return callback(null, true);
            if (allowed.includes(origin))
                return callback(null, true);
            console.warn(`CORS blocked origin: ${origin}`);
            return callback(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
    };
}
function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}
function requireJwtSecret() {
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret || secret.length < 32 || secret === 'secret' || secret === 'fallback-secret') {
        throw new Error('JWT_SECRET must be set to a strong random value (min 32 chars). Refusing to start.');
    }
    return secret;
}
//# sourceMappingURL=security.js.map