"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressionMiddleware = compressionMiddleware;
const zlib_1 = require("zlib");
const util_1 = require("util");
const gzipAsync = (0, util_1.promisify)(zlib_1.gzip);
const brotliAsync = (0, util_1.promisify)(zlib_1.brotliCompress);
const MIN_SIZE = 1024;
const compressible = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg\+xml)/i;
function compressionMiddleware(req, res, next) {
    const accept = String(req.headers['accept-encoding'] || '');
    const preferBrotli = /\bbr\b/.test(accept);
    const preferGzip = /\bgzip\b/.test(accept);
    if (!preferBrotli && !preferGzip)
        return next();
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const maybeCompress = async (body, asJson) => {
        if (res.headersSent || res.getHeader('Content-Encoding')) {
            return asJson ? originalJson(body) : originalSend(body);
        }
        let payload;
        if (Buffer.isBuffer(body)) {
            payload = body;
        }
        else if (typeof body === 'string') {
            payload = Buffer.from(body);
        }
        else if (asJson) {
            payload = Buffer.from(JSON.stringify(body ?? null));
            if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
        }
        else {
            return originalSend(body);
        }
        const contentType = String(res.getHeader('Content-Type') || (asJson ? 'application/json' : ''));
        if (payload.length < MIN_SIZE || (contentType && !compressible.test(contentType))) {
            return asJson ? originalSend(payload) : originalSend(payload);
        }
        try {
            if (preferBrotli) {
                const compressed = await brotliAsync(payload, {
                    params: {
                        [zlib_1.constants.BROTLI_PARAM_QUALITY]: 4,
                    },
                });
                res.setHeader('Content-Encoding', 'br');
                res.setHeader('Vary', 'Accept-Encoding');
                res.removeHeader('Content-Length');
                return originalSend(compressed);
            }
            const compressed = await gzipAsync(payload, { level: 6 });
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Vary', 'Accept-Encoding');
            res.removeHeader('Content-Length');
            return originalSend(compressed);
        }
        catch {
            return asJson ? originalSend(payload) : originalSend(payload);
        }
    };
    res.json = ((body) => {
        void maybeCompress(body, true);
        return res;
    });
    res.send = ((body) => {
        void maybeCompress(body, false);
        return res;
    });
    next();
}
//# sourceMappingURL=compression.js.map