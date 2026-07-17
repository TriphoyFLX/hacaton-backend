"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMessageContent = validateMessageContent;
exports.sanitizeMessageContent = sanitizeMessageContent;
const MAX_MESSAGE_LENGTH = 4000;
const HTML_TAG_REGEX = /<[^>]*>/g;
function validateMessageContent(raw, options = {}) {
    if (raw == null || raw === '') {
        if (options.allowEmpty) {
            return { valid: true, content: '' };
        }
        return { valid: false, error: 'Сообщение не может быть пустым' };
    }
    if (typeof raw !== 'string') {
        return { valid: false, error: 'Сообщение должно быть текстом' };
    }
    const content = sanitizeMessageContent(raw);
    if (!content && !options.allowEmpty) {
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
function sanitizeMessageContent(raw) {
    return raw
        .replace(/\u0000/g, '')
        .replace(HTML_TAG_REGEX, '')
        .replace(/\s+/g, (match) => (match.includes('\n') ? match : ' '))
        .trim();
}
//# sourceMappingURL=messageValidation.js.map