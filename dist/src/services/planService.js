"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanTier = exports.PaymentStatus = exports.PaymentKind = void 0;
exports.getActivePlan = getActivePlan;
exports.getBillingSnapshot = getBillingSnapshot;
exports.assertCanCreateMidiProject = assertCanCreateMidiProject;
exports.recordMidiCloudSave = recordMidiCloudSave;
exports.consumeAiGenerationTokens = consumeAiGenerationTokens;
exports.fulfillPayment = fulfillPayment;
exports.markPaymentCanceled = markPaymentCanceled;
const client_1 = require("@prisma/client");
Object.defineProperty(exports, "PlanTier", { enumerable: true, get: function () { return client_1.PlanTier; } });
Object.defineProperty(exports, "PaymentKind", { enumerable: true, get: function () { return client_1.PaymentKind; } });
Object.defineProperty(exports, "PaymentStatus", { enumerable: true, get: function () { return client_1.PaymentStatus; } });
const plans_1 = require("../config/plans");
const prisma = new client_1.PrismaClient();
function utcDayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
}
async function getActivePlan(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, planExpiresAt: true, role: true },
    });
    if (!user)
        return 'FREE';
    if (user.role === 'ADMIN')
        return 'PLATINUM';
    if (user.plan !== 'FREE' && user.planExpiresAt && user.planExpiresAt < new Date()) {
        await prisma.user.update({
            where: { id: userId },
            data: { plan: 'FREE', planExpiresAt: null },
        });
        return 'FREE';
    }
    return user.plan;
}
async function getBillingSnapshot(userId) {
    const plan = await getActivePlan(userId);
    const cfg = plans_1.PLAN_CATALOG[plan];
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
    if (user.midiSavesDayKey !== dayKey)
        savesToday = 0;
    const cloudProjectCount = await prisma.midiProject.count({ where: { ownerId: userId } });
    let canCreate = true;
    if (cfg.maxCloudProjects != null && cloudProjectCount >= cfg.maxCloudProjects) {
        canCreate = false;
    }
    if (cfg.maxCloudSavesPerDay != null && savesToday >= cfg.maxCloudSavesPerDay) {
        canCreate = false;
    }
    const generationsAvailable = Math.floor(user.tokenBalance / plans_1.TOKENS_PER_GENERATION);
    return {
        plan,
        planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
        tokenBalance: user.tokenBalance,
        vocalPresets: cfg.vocalPresets,
        maxCloudProjects: cfg.maxCloudProjects,
        maxCloudSavesPerDay: cfg.maxCloudSavesPerDay,
        cloudProjectCount,
        midiSavesToday: savesToday,
        midiSavesRemainingToday: cfg.maxCloudSavesPerDay == null ? null : Math.max(0, cfg.maxCloudSavesPerDay - savesToday),
        canCreateCloudProject: canCreate,
        canGenerateAi: user.tokenBalance >= plans_1.TOKENS_PER_GENERATION,
        generationsAvailable,
        catalog: plans_1.PLAN_CATALOG,
        tokenPacks: plans_1.TOKEN_PACKS,
        tokensPerGeneration: plans_1.TOKENS_PER_GENERATION,
    };
}
async function assertCanCreateMidiProject(userId) {
    const snap = await getBillingSnapshot(userId);
    if (snap.canCreateCloudProject)
        return;
    if (snap.maxCloudSavesPerDay != null && snap.midiSavesToday >= snap.maxCloudSavesPerDay) {
        const err = new Error(`Дневной лимит сохранений в облако исчерпан (${snap.maxCloudSavesPerDay}/день на тарифе ${snap.plan}).`);
        err.status = 402;
        err.code = 'MIDI_DAILY_LIMIT';
        throw err;
    }
    const err = new Error(`Лимит облачных проектов: ${snap.cloudProjectCount}/${snap.maxCloudProjects}. Обновите тариф.`);
    err.status = 402;
    err.code = 'MIDI_PROJECT_LIMIT';
    throw err;
}
async function recordMidiCloudSave(userId) {
    const dayKey = utcDayKey();
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { midiSavesDayKey: true, midiSavesToday: true },
    });
    if (!user)
        return;
    if (user.midiSavesDayKey !== dayKey) {
        await prisma.user.update({
            where: { id: userId },
            data: { midiSavesDayKey: dayKey, midiSavesToday: 1 },
        });
    }
    else {
        await prisma.user.update({
            where: { id: userId },
            data: { midiSavesToday: { increment: 1 } },
        });
    }
}
async function consumeAiGenerationTokens(userId) {
    const plan = await getActivePlan(userId);
    if (plan === 'FREE') {
        const err = new Error('AI-генерации недоступны на тарифе Free. Оформите Pro или Platinum.');
        err.status = 402;
        err.code = 'AI_PLAN_REQUIRED';
        throw err;
    }
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tokenBalance: true },
    });
    if (!user || user.tokenBalance < plans_1.TOKENS_PER_GENERATION) {
        const err = new Error(`Недостаточно токенов (нужно ${plans_1.TOKENS_PER_GENERATION}). Купите пакет токенов или обновите подписку.`);
        err.status = 402;
        err.code = 'AI_TOKENS_EMPTY';
        throw err;
    }
    const updated = await prisma.user.update({
        where: { id: userId },
        data: { tokenBalance: { decrement: plans_1.TOKENS_PER_GENERATION } },
        select: { tokenBalance: true },
    });
    return updated.tokenBalance;
}
async function fulfillPayment(paymentId) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status === 'SUCCEEDED')
        return;
    await prisma.$transaction(async (tx) => {
        const locked = await tx.payment.findUnique({ where: { id: paymentId } });
        if (!locked || locked.status === 'SUCCEEDED')
            return;
        await tx.payment.update({
            where: { id: paymentId },
            data: { status: 'SUCCEEDED' },
        });
        if (locked.kind === 'TOKENS_400') {
            await tx.user.update({
                where: { id: locked.userId },
                data: { tokenBalance: { increment: plans_1.TOKEN_PACKS.TOKENS_400.tokens } },
            });
            return;
        }
        const tier = locked.kind === 'PLAN_PLATINUM' ? 'PLATINUM' : 'PRO';
        const monthlyTokens = tier === 'PLATINUM' ? plans_1.PLAN_CATALOG.PLATINUM.monthlyTokens : plans_1.PLAN_CATALOG.PRO.monthlyTokens;
        const user = await tx.user.findUniqueOrThrow({
            where: { id: locked.userId },
            select: { planExpiresAt: true },
        });
        const base = user.planExpiresAt && user.planExpiresAt > new Date() ? user.planExpiresAt : new Date();
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
async function markPaymentCanceled(paymentId) {
    await prisma.payment.updateMany({
        where: { id: paymentId, status: { not: 'SUCCEEDED' } },
        data: { status: 'CANCELED' },
    });
}
//# sourceMappingURL=planService.js.map