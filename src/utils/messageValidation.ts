const MAX_MESSAGE_LENGTH = 4000;
const HTML_TAG_REGEX = /<[^>]*>/g;

export interface MessageValidationResult {
  valid: boolean;
  content?: string;
  error?: string;
}

export function validateMessageContent(raw: unknown): MessageValidationResult {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Сообщение должно быть текстом' };
  }

  const content = sanitizeMessageContent(raw);

  if (!content) {
    return { valid: false, error: 'Сообщение не может быть пустым' };
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: `Сообщение слишком длинное (максимум ${MAX_MESSAGE_LENGTH} символов)`,
    };
  }

  return { valid: true, content };
}

export function sanitizeMessageContent(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(HTML_TAG_REGEX, '')
    .replace(/\s+/g, (match) => (match.includes('\n') ? match : ' '))
    .trim();
}
