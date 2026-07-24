const HTML_TAG_REGEX = /<[^>]*>/g;
const CTRL_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strip HTML/control chars from user-generated text (posts, bios, descriptions). */
export function sanitizeUserText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(CTRL_REGEX, '')
    .replace(HTML_TAG_REGEX, '')
    .replace(/\s+/g, (match) => (match.includes('\n') ? match.slice(0, 4) : ' '))
    .trim()
    .slice(0, maxLen);
}
