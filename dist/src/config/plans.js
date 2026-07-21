"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_PACKS = exports.PLAN_CATALOG = exports.TOKENS_PER_GENERATION = void 0;
exports.productForKind = productForKind;
exports.TOKENS_PER_GENERATION = 100;
exports.PLAN_CATALOG = {
    FREE: {
        id: 'FREE',
        name: 'Free',
        priceRub: 0,
        maxCloudProjects: 5,
        maxCloudSavesPerDay: null,
        monthlyTokens: 0,
        vocalPresets: false,
        description: '5 проектов в облаке секвенсора. Без AI-генераций и без вокальных пресетов.',
    },
    PRO: {
        id: 'PRO',
        name: 'Pro',
        priceRub: 299,
        maxCloudProjects: 30,
        maxCloudSavesPerDay: null,
        monthlyTokens: 300,
        vocalPresets: true,
        description: '30 проектов в облаке, 300 токенов (3 AI-генерации), вокальные пресеты.',
    },
    PLATINUM: {
        id: 'PLATINUM',
        name: 'Platinum',
        priceRub: 699,
        maxCloudProjects: null,
        maxCloudSavesPerDay: 20,
        monthlyTokens: 700,
        vocalPresets: true,
        description: 'Всё безлимитно, до 20 сохранений в облако в день, 700 токенов (7 AI-генераций).',
    },
};
exports.TOKEN_PACKS = {
    TOKENS_400: {
        id: 'TOKENS_400',
        name: 'Пакет 400 токенов',
        tokens: 400,
        priceRub: 199,
        generations: 4,
        description: '400 токенов ≈ 4 AI-генерации. Можно купить в любой момент.',
    },
};
function productForKind(kind) {
    if (kind === 'PLAN_PRO') {
        return { kind, amountRub: exports.PLAN_CATALOG.PRO.priceRub, description: `Подписка SoundLab Pro — ${exports.PLAN_CATALOG.PRO.priceRub} ₽ / 30 дней` };
    }
    if (kind === 'PLAN_PLATINUM') {
        return { kind, amountRub: exports.PLAN_CATALOG.PLATINUM.priceRub, description: `Подписка SoundLab Platinum — ${exports.PLAN_CATALOG.PLATINUM.priceRub} ₽ / 30 дней` };
    }
    return { kind, amountRub: exports.TOKEN_PACKS.TOKENS_400.priceRub, description: `Пакет токенов SoundLab — ${exports.TOKEN_PACKS.TOKENS_400.tokens} шт.` };
}
//# sourceMappingURL=plans.js.map