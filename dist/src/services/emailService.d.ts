export declare function hashVerificationCode(code: string): string;
export declare function verifyVerificationCode(storedCode: string, submittedCode: string): boolean;
export declare function sendVerificationEmail(email: string, code: string): Promise<void>;
export declare function sendAdminNotification(subject: string, text: string): Promise<void>;
export declare function createVerificationPayload(): {
    code: string;
    expires: Date;
};
export declare function isEmailConfigured(): boolean;
//# sourceMappingURL=emailService.d.ts.map