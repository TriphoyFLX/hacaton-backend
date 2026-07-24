"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_PACKS = exports.PLAN_CATALOG = exports.GENERATION_COST_RUB = exports.TOKENS_PER_GENERATION = void 0;
exports.baseGenerationPriceRub = baseGenerationPriceRub;
exports.packCompareAtRub = packCompareAtRub;
exports.packSaveRub = packSaveRub;
exports.packSavePercent = packSavePercent;
exports.isTokenPackKind = isTokenPackKind;
exports.productForKind = productForKind;
exports.TOKENS_PER_GENERATION = 100;
exports.GENERATION_COST_RUB = 17;
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
        priceRub: 249,
        maxCloudProjects: 30,
        maxCloudSavesPerDay: null,
        monthlyTokens: 300,
        vocalPresets: true,
        description: '30 проектов в облаке, 300 токенов (3 AI-генерации), вокальные пресеты.',
    },
    PLATINUM: {
        id: 'PLATINUM',
        name: 'Platinum',
        priceRub: 499,
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
        priceRub: 299,
        generations: 4,
        description: 'Базовый пакет: 4 генерации.',
        badge: null,
    },
    TOKENS_800: {
        id: 'TOKENS_800',
        name: 'Пакет 800 токенов',
        tokens: 800,
        priceRub: 549,
        generations: 8,
        description: 'Стандартный пакет: −8% к цене за генерацию.',
        badge: '−8%',
    },
    TOKENS_1200: {
        id: 'TOKENS_1200',
        name: 'Пакет 1200 токенов',
        tokens: 1200,
        priceRub: 799,
        generations: 12,
        description: 'Расширенный пакет: −11% к цене за генерацию.',
        badge: '−11%',
    },
    TOKENS_2400: {
        id: 'TOKENS_2400',
        name: 'Пакет 2400 токенов',
        tokens: 2400,
        priceRub: 1399,
        generations: 24,
        description: 'Максимальный пакет: −22% к цене за генерацию.',
        badge: '−22%',
    },
};
function baseGenerationPriceRub() {
    const base = exports.TOKEN_PACKS.TOKENS_400;
    return base.priceRub / base.generations;
}
function packCompareAtRub(pack) {
    return Math.round(baseGenerationPriceRub() * pack.generations);
}
function packSaveRub(pack) {
    return Math.max(0, packCompareAtRub(pack) - pack.priceRub);
}
function packSavePercent(pack) {
    const compare = packCompareAtRub(pack);
    if (compare <= 0)
        return 0;
    return Math.round((packSaveRub(pack) / compare) * 100);
}
function isTokenPackKind(kind) {
    return kind in exports.TOKEN_PACKS;
}
function productForKind(kind) {
    if (kind === 'PLAN_PRO') {
        return { kind, amountRub: exports.PLAN_CATALOG.PRO.priceRub, description: `Подписка SoundLab Pro — ${exports.PLAN_CATALOG.PRO.priceRub} ₽ / 30 дней` };
    }
    if (kind === 'PLAN_PLATINUM') {
        return { kind, amountRub: exports.PLAN_CATALOG.PLATINUM.priceRub, description: `Подписка SoundLab Platinum — ${exports.PLAN_CATALOG.PLATINUM.priceRub} ₽ / 30 дней` };
    }
    const pack = exports.TOKEN_PACKS[kind];
    return { kind, amountRub: pack.priceRub, description: `Пакет токенов SoundLab — ${pack.tokens} шт.` };
}
//# sourceMappingURL=plans.js.map