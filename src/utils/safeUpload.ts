import path from 'path';
import crypto from 'crypto';

const ALLOWED_EXT_TO_KIND: Record<string, 'IMAGE' | 'VIDEO' | 'AUDIO'> = {
  '.jpg': 'IMAGE',
  '.jpeg': 'IMAGE',
  '.png': 'IMAGE',
  '.gif': 'IMAGE',
  '.webp': 'IMAGE',
  '.mp4': 'VIDEO',
  '.webm': 'VIDEO',
  '.mov': 'VIDEO',
  '.mp3': 'AUDIO',
  '.wav': 'AUDIO',
  '.ogg': 'AUDIO',
  '.flac': 'AUDIO',
  '.m4a': 'AUDIO',
  '.aac': 'AUDIO',
};

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'audio/webm',
  'audio/x-m4a',
]);

/** Normalize and whitelist file extension; reject path tricks / double-dots. */
export function safeUploadExtension(originalName: string): string | null {
  const base = path.basename(String(originalName || '')).toLowerCase();
  if (!base || base.includes('\0') || base.includes('..')) return null;
  const ext = path.extname(base);
  if (!ext || !(ext in ALLOWED_EXT_TO_KIND)) return null;
  return ext;
}

export function mediaKindFromExt(ext: string): 'IMAGE' | 'VIDEO' | 'AUDIO' {
  return ALLOWED_EXT_TO_KIND[ext.toLowerCase()] || 'IMAGE';
}

export function isAllowedUploadMime(mime: string): boolean {
  const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
  return ALLOWED_MIMES.has(normalized);
}

export function isAllowedUploadFile(originalName: string, mime: string): boolean {
  const ext = safeUploadExtension(originalName);
  if (!ext) return false;
  if (!isAllowedUploadMime(mime)) return false;
  const kind = mediaKindFromExt(ext);
  const m = mime.toLowerCase();
  if (kind === 'IMAGE' && !m.startsWith('image/')) return false;
  if (kind === 'VIDEO' && !m.startsWith('video/')) return false;
  if (kind === 'AUDIO' && !m.startsWith('audio/')) return false;
  return true;
}

export function buildSafeUploadFilename(originalName: string): string | null {
  const ext = safeUploadExtension(originalName);
  if (!ext) return null;
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export function isAllowedAudioSample(originalName: string, mime: string): boolean {
  const name = String(originalName || '');
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const extOk = /\.(mp3|wav|ogg|flac|m4a|aac|aiff?|webm)$/i.test(name);
  const mimeOk =
    m.startsWith('audio/') ||
    m === 'application/octet-stream'; // some browsers send this for wav
  return extOk && mimeOk && !name.includes('..') && !name.includes('\0');
}
