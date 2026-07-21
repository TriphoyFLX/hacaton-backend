/** SoundLab subscription & token catalog (server source of truth). */

export type PlanId = 'FREE' | 'PRO' | 'PLATINUM';

export const TOKENS_PER_GENERATION = 100;

export const PLAN_CATALOG = {
  FREE: {
    id: 'FREE' as const,
    name: 'Free',
    priceRub: 0,
    maxCloudProjects: 5,
    /** null = no daily cap (use maxCloudProjects only) */
    maxCloudSavesPerDay: null as number | null,
    monthlyTokens: 0,
    vocalPresets: false,
    description: '5 проектов в облаке секвенсора. Без AI-генераций и без вокальных пресетов.',
  },
  PRO: {
    id: 'PRO' as const,
    name: 'Pro',
    priceRub: 249,
    maxCloudProjects: 30,
    maxCloudSavesPerDay: null as number | null,
    monthlyTokens: 300, // 3 генерации
    vocalPresets: true,
    description: '30 проектов в облаке, 300 токенов (3 AI-генерации), вокальные пресеты.',
  },
  PLATINUM: {
    id: 'PLATINUM' as const,
    name: 'Platinum',
    priceRub: 499,
    maxCloudProjects: null as number | null, // unlimited total
    maxCloudSavesPerDay: 20,
    monthlyTokens: 700, // 7 генераций
    vocalPresets: true,
    description: 'Всё безлимитно, до 20 сохранений в облако в день, 700 токенов (7 AI-генераций).',
  },
} as const;

export const TOKEN_PACKS = {
  TOKENS_400: {
    id: 'TOKENS_400' as const,
    name: 'Пакет 400 токенов',
    tokens: 400,
    priceRub: 199,
    generations: 4,
    description: '400 токенов ≈ 4 AI-генерации. Можно купить в любой момент.',
  },
} as const;

export type PaymentProductKind = 'PLAN_PRO' | 'PLAN_PLATINUM' | 'TOKENS_400';

export function productForKind(kind: PaymentProductKind) {
  if (kind === 'PLAN_PRO') {
    return { kind, amountRub: PLAN_CATALOG.PRO.priceRub, description: `Подписка SoundLab Pro — ${PLAN_CATALOG.PRO.priceRub} ₽ / 30 дней` };
  }
  if (kind === 'PLAN_PLATINUM') {
    return { kind, amountRub: PLAN_CATALOG.PLATINUM.priceRub, description: `Подписка SoundLab Platinum — ${PLAN_CATALOG.PLATINUM.priceRub} ₽ / 30 дней` };
  }
  return { kind, amountRub: TOKEN_PACKS.TOKENS_400.priceRub, description: `Пакет токенов SoundLab — ${TOKEN_PACKS.TOKENS_400.tokens} шт.` };
}
