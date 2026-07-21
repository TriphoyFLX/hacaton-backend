import { PlanTier, PaymentKind, PaymentStatus } from '@prisma/client';
import { PLAN_CATALOG, TOKEN_PACKS, type PlanId } from '../config/plans';
export type EffectivePlan = {
    plan: PlanId;
    planExpiresAt: string | null;
    tokenBalance: number;
    vocalPresets: boolean;
    maxCloudProjects: number | null;
    maxCloudSavesPerDay: number | null;
    cloudProjectCount: number;
    midiSavesToday: number;
    midiSavesRemainingToday: number | null;
    canCreateCloudProject: boolean;
    canGenerateAi: boolean;
    generationsAvailable: number;
    catalog: typeof PLAN_CATALOG;
    tokenPacks: typeof TOKEN_PACKS;
    tokensPerGeneration: number;
};
export declare function getActivePlan(userId: string): Promise<PlanId>;
export declare function getBillingSnapshot(userId: string): Promise<EffectivePlan>;
export declare function assertCanCreateMidiProject(userId: string): Promise<void>;
export declare function recordMidiCloudSave(userId: string): Promise<void>;
export declare function consumeAiGenerationTokens(userId: string): Promise<number>;
export declare function fulfillPayment(paymentId: string): Promise<void>;
export declare function markPaymentCanceled(paymentId: string): Promise<void>;
export { PaymentKind, PaymentStatus, PlanTier };
//# sourceMappingURL=planService.d.ts.map