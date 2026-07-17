export interface MessageValidationResult {
    valid: boolean;
    content?: string;
    error?: string;
}
export declare function validateMessageContent(raw: unknown, options?: {
    allowEmpty?: boolean;
}): MessageValidationResult;
export declare function sanitizeMessageContent(raw: string): string;
//# sourceMappingURL=messageValidation.d.ts.map