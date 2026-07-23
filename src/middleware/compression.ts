import { brotliCompress, constants as zlibConstants, gzip } from 'zlib';
import { promisify } from 'util';
import type { NextFunction, Request, Response } from 'express';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

const MIN_SIZE = 1024;
const compressible = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg\+xml)/i;

/**
 * Lightweight response compression without an extra dependency.
 * Skips small bodies, already-encoded responses, and non-text types.
 */
export function compressionMiddleware(req: Request, res: Response, next: NextFunction) {
  const accept = String(req.headers['accept-encoding'] || '');
  const preferBrotli = /\bbr\b/.test(accept);
  const preferGzip = /\bgzip\b/.test(accept);
  if (!preferBrotli && !preferGzip) return next();

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  const maybeCompress = async (body: unknown, asJson: boolean) => {
    if (res.headersSent || res.getHeader('Content-Encoding')) {
      return asJson ? originalJson(body) : originalSend(body as any);
    }

    let payload: Buffer;
    if (Buffer.isBuffer(body)) {
      payload = body;
    } else if (typeof body === 'string') {
      payload = Buffer.from(body);
    } else if (asJson) {
      payload = Buffer.from(JSON.stringify(body ?? null));
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
    } else {
      return originalSend(body as any);
    }

    const contentType = String(res.getHeader('Content-Type') || (asJson ? 'application/json' : ''));
    if (payload.length < MIN_SIZE || (contentType && !compressible.test(contentType))) {
      return asJson ? originalSend(payload) : originalSend(payload);
    }

    try {
      if (preferBrotli) {
        const compressed = await brotliAsync(payload, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
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
    } catch {
      return asJson ? originalSend(payload) : originalSend(payload);
    }
  };

  res.json = ((body: unknown) => {
    void maybeCompress(body, true);
    return res;
  }) as Response['json'];

  res.send = ((body: unknown) => {
    void maybeCompress(body, false);
    return res;
  }) as Response['send'];

  next();
}
