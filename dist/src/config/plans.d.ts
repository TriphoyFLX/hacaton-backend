export type PlanId = 'FREE' | 'PRO' | 'PLATINUM';
export declare const TOKENS_PER_GENERATION = 100;
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
        readonly priceRub: 299;
        readonly maxCloudProjects: 30;
        readonly maxCloudSavesPerDay: number | null;
        readonly monthlyTokens: 300;
        readonly vocalPresets: true;
        readonly description: "30 проектов в облаке, 300 токенов (3 AI-генерации), вокальные пресеты.";
    };
    readonly PLATINUM: {
        readonly id: "PLATINUM";
        readonly name: "Platinum";
        readonly priceRub: 699;
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
        readonly priceRub: 199;
        readonly generations: 4;
        readonly description: "400 токенов ≈ 4 AI-генерации. Можно купить в любой момент.";
    };
};
export type PaymentProductKind = 'PLAN_PRO' | 'PLAN_PLATINUM' | 'TOKENS_400';
export declare function productForKind(kind: PaymentProductKind): {
    kind: "PLAN_PRO";
    amountRub: 299;
    description: string;
} | {
    kind: "PLAN_PLATINUM";
    amountRub: 699;
    description: string;
} | {
    kind: "TOKENS_400";
    amountRub: 199;
    description: string;
};
//# sourceMappingURL=plans.d.ts.map