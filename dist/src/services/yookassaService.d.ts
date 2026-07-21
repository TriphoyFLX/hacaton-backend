import { type PaymentProductKind } from '../config/plans';
export declare function isYooKassaConfigured(): boolean;
export declare function createYooKassaPayment(opts: {
    userId: string;
    kind: PaymentProductKind;
    returnUrl: string;
}): Promise<{
    paymentId: string;
    yookassaPaymentId: string;
    confirmationUrl: string | null;
    amountRub: 299 | 699 | 199;
    kind: PaymentProductKind;
}>;
export declare function handleYooKassaWebhook(notification: any): Promise<void>;
export declare function syncPaymentStatus(userId: string, paymentId: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    yookassaPaymentId: string | null;
    kind: import(".prisma/client").$Enums.PaymentKind;
    status: import(".prisma/client").$Enums.PaymentStatus;
    amountRub: number;
    confirmationUrl: string | null;
    description: string;
    metadata: import("@prisma/client/runtime/library").JsonValue | null;
}>;
//# sourceMappingURL=yookassaService.d.ts.map