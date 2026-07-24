export type PlanId = 'FREE' | 'PRO' | 'PLATINUM';
export declare const TOKENS_PER_GENERATION = 100;
export declare const GENERATION_COST_RUB = 17;
export declare const PLAN_CATALOG: {
    readonly FREE: {
        readonly id: "FREE";
        readonly name: "Free";
        readonly priceRub: 0;
        readonly maxCloudProjects: 5;
        readonly maxCloudSavesPerDay: number | null;
        readonly monthlyTokens: 0;
        readonly vocalPresets: false;
        readonly description: "5 проектов в облаке секвенсора. Без AI-генераций и без вокальных пресетов.";
    };
    readonly PRO: {
        readonly id: "PRO";
        readonly name: "Pro";
        readonly priceRub: 249;
        readonly maxCloudProjects: 30;
        readonly maxCloudSavesPerDay: number | null;
        readonly monthlyTokens: 300;
        readonly vocalPresets: true;
        readonly description: "30 проектов в облаке, 300 токенов (3 AI-генерации), вокальные пресеты.";
    };
    readonly PLATINUM: {
        readonly id: "PLATINUM";
        readonly name: "Platinum";
        readonly priceRub: 499;
        readonly maxCloudProjects: number | null;
        readonly maxCloudSavesPerDay: 20;
        readonly monthlyTokens: 700;
        readonly vocalPresets: true;
        readonly description: "Всё безлимитно, до 20 сохранений в облако в день, 700 токенов (7 AI-генераций).";
    };
};
export declare const TOKEN_PACKS: {
    readonly TOKENS_400: {
        readonly id: "TOKENS_400";
        readonly name: "Пакет 400 токенов";
        readonly tokens: 400;
        readonly priceRub: 299;
        readonly generations: 4;
        readonly description: "Базовый пакет: 4 генерации.";
        readonly badge: string | null;
    };
    readonly TOKENS_800: {
        readonly id: "TOKENS_800";
        readonly name: "Пакет 800 токенов";
        readonly tokens: 800;
        readonly priceRub: 549;
        readonly generations: 8;
        readonly description: "Стандартный пакет: −8% к цене за генерацию.";
        readonly badge: "−8%";
    };
    readonly TOKENS_1200: {
        readonly id: "TOKENS_1200";
        readonly name: "Пакет 1200 токенов";
        readonly tokens: 1200;
        readonly priceRub: 799;
        readonly generations: 12;
        readonly description: "Расширенный пакет: −11% к цене за генерацию.";
        readonly badge: "−11%";
    };
    readonly TOKENS_2400: {
        readonly id: "TOKENS_2400";
        readonly name: "Пакет 2400 токенов";
        readonly tokens: 2400;
        readonly priceRub: 1399;
        readonly generations: 24;
        readonly description: "Максимальный пакет: −22% к цене за генерацию.";
        readonly badge: "−22%";
    };
};
export type TokenPackId = keyof typeof TOKEN_PACKS;
export type PaymentProductKind = 'PLAN_PRO' | 'PLAN_PLATINUM' | TokenPackId;
export declare function baseGenerationPriceRub(): number;
export declare function packCompareAtRub(pack: (typeof TOKEN_PACKS)[TokenPackId]): number;
export declare function packSaveRub(pack: (typeof TOKEN_PACKS)[TokenPackId]): number;
export declare function packSavePercent(pack: (typeof TOKEN_PACKS)[TokenPackId]): number;
export declare function isTokenPackKind(kind: string): kind is TokenPackId;
export declare function productForKind(kind: PaymentProductKind): {
    kind: "PLAN_PRO";
    amountRub: 249;
    description: string;
} | {
    kind: "PLAN_PLATINUM";
    amountRub: 499;
    description: string;
} | {
    kind: "TOKENS_400" | "TOKENS_800" | "TOKENS_1200" | "TOKENS_2400";
    amountRub: 1399 | 799 | 549 | 299 | 249 | 499;
    description: string;
};
//# sourceMappingURL=plans.d.ts.map