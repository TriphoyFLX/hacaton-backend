export declare function sendVerificationEmail(email: string, code: string): Promise<void>;
export declare function sendAdminNotification(subject: string, text: string): Promise<void>;
export declare function createVerificationPayload(): {
    code: string;
    expires: Date;
};
export declare function isEmailConfigured(): boolean;
//# sourceMappingURL=emailService.d.ts.map