import { PrismaClient, PlanTier, PaymentKind, PaymentStatus } from '@prisma/client';
import {
  PLAN_CATALOG,
  TOKEN_PACKS,
  TOKENS_PER_GENERATION,
  type PlanId,
} from '../config/plans';

const prisma = new PrismaClient();

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

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

export async function getActivePlan(userId: string): Promise<PlanId> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true, role: true },
  });
  if (!user) return 'FREE';
  if (user.role === 'ADMIN') return 'PLATINUM';

  if (user.plan !== 'FREE' && user.planExpiresAt && user.planExpiresAt < new Date()) {
    await prisma.user.update({
      where: { id: userId },
      data: { plan: 'FREE', planExpiresAt: null },
    });
    return 'FREE';
  }
  return user.plan as PlanId;
}

export async function getBillingSnapshot(userId: string): Promise<EffectivePlan> {
  const plan = await getActivePlan(userId);
  const cfg = PLAN_CATALOG[plan];
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      planExpiresAt: true,
      tokenBalance: true,
      midiSavesDayKey: true,
      midiSavesToday: true,
    },
  });

  const dayKey = utcDayKey();
  let savesToday = user.midiSavesToday;
  if (user.midiSavesDayKey !== dayKey) savesToday = 0;

  const cloudProjectCount = await prisma.midiProject.count({ where: { ownerId: userId } });

  let canCreate = true;
  if (cfg.maxCloudProjects != null && cloudProjectCount >= cfg.maxCloudProjects) {
    canCreate = false;
  }
  if (cfg.maxCloudSavesPerDay != null && savesToday >= cfg.maxCloudSavesPerDay) {
    canCreate = false;
  }

  const generationsAvailable = Math.floor(user.tokenBalance / TOKENS_PER_GENERATION);

  return {
    plan,
    planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
    tokenBalance: user.tokenBalance,
    vocalPresets: cfg.vocalPresets,
    maxCloudProjects: cfg.maxCloudProjects,
    maxCloudSavesPerDay: cfg.maxCloudSavesPerDay,
    cloudProjectCount,
    midiSavesToday: savesToday,
    midiSavesRemainingToday:
      cfg.maxCloudSavesPerDay == null ? null : Math.max(0, cfg.maxCloudSavesPerDay - savesToday),
    canCreateCloudProject: canCreate,
    canGenerateAi: user.tokenBalance >= TOKENS_PER_GENERATION,
    generationsAvailable,
    catalog: PLAN_CATALOG,
    tokenPacks: TOKEN_PACKS,
    tokensPerGeneration: TOKENS_PER_GENERATION,
  };
}

export async function assertCanCreateMidiProject(userId: string): Promise<void> {
  const snap = await getBillingSnapshot(userId);
  if (snap.canCreateCloudProject) return;

  if (snap.maxCloudSavesPerDay != null && snap.midiSavesToday >= snap.maxCloudSavesPerDay) {
    const err: any = new Error(
      `Дневной лимит сохранений в облако исчерпан (${snap.maxCloudSavesPerDay}/день на тарифе ${snap.plan}).`,
    );
    err.status = 402;
    err.code = 'MIDI_DAILY_LIMIT';
    throw err;
  }

  const err: any = new Error(
    `Лимит облачных проектов: ${snap.cloudProjectCount}/${snap.maxCloudProjects}. Обновите тариф.`,
  );
  err.status = 402;
  err.code = 'MIDI_PROJECT_LIMIT';
  throw err;
}

/** Call after successful midi project create. */
export async function recordMidiCloudSave(userId: string): Promise<void> {
  const dayKey = utcDayKey();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { midiSavesDayKey: true, midiSavesToday: true },
  });
  if (!user) return;

  if (user.midiSavesDayKey !== dayKey) {
    await prisma.user.update({
      where: { id: userId },
      data: { midiSavesDayKey: dayKey, midiSavesToday: 1 },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: { midiSavesToday: { increment: 1 } },
    });
  }
}

export async function consumeAiGenerationTokens(userId: string): Promise<number> {
  const plan = await getActivePlan(userId);
  if (plan === 'FREE') {
    const err: any = new Error('AI-генерации недоступны на тарифе Free. Оформите Pro или Platinum.');
    err.status = 402;
    err.code = 'AI_PLAN_REQUIRED';
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenBalance: true },
  });
  if (!user || user.tokenBalance < TOKENS_PER_GENERATION) {
    const err: any = new Error(
      `Недостаточно токенов (нужно ${TOKENS_PER_GENERATION}). Купите пакет токенов или обновите подписку.`,
    );
    err.status = 402;
    err.code = 'AI_TOKENS_EMPTY';
    throw err;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenBalance: { decrement: TOKENS_PER_GENERATION } },
    select: { tokenBalance: true },
  });
  return updated.tokenBalance;
}

export async function fulfillPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === 'SUCCEEDED') return;

  await prisma.$transaction(async (tx) => {
    const locked = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!locked || locked.status === 'SUCCEEDED') return;

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'SUCCEEDED' },
    });

    if (locked.kind === 'TOKENS_400') {
      await tx.user.update({
        where: { id: locked.userId },
        data: { tokenBalance: { increment: TOKEN_PACKS.TOKENS_400.tokens } },
      });
      return;
    }

    const tier: PlanTier = locked.kind === 'PLAN_PLATINUM' ? 'PLATINUM' : 'PRO';
    const monthlyTokens =
      tier === 'PLATINUM' ? PLAN_CATALOG.PLATINUM.monthlyTokens : PLAN_CATALOG.PRO.monthlyTokens;

    const user = await tx.user.findUniqueOrThrow({
      where: { id: locked.userId },
      select: { planExpiresAt: true },
    });

    const base =
      user.planExpiresAt && user.planExpiresAt > new Date() ? user.planExpiresAt : new Date();
    const expires = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    await tx.user.update({
      where: { id: locked.userId },
      data: {
        plan: tier,
        planExpiresAt: expires,
        tokenBalance: { increment: monthlyTokens },
      },
    });
  });
}

export async function markPaymentCanceled(paymentId: string): Promise<void> {
  await prisma.payment.updateMany({
    where: { id: paymentId, status: { not: 'SUCCEEDED' } },
    data: { status: 'CANCELED' },
  });
}

export { PaymentKind, PaymentStatus, PlanTier };
