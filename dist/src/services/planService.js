"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const prisma_1 = require("../lib/prisma");
const plans_1 = require("../config/plans");
function utcDayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
}
async function getActivePlan(userId) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, planExpiresAt: true, role: true },
    });
    if (!user)
        return 'FREE';
    if (user.role === 'ADMIN')
        return 'PLATINUM';
    if (user.plan !== 'FREE' && user.planExpiresAt && user.planExpiresAt < new Date()) {
        await prisma_1.prisma.user.update({
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
    const user = await prisma_1.prisma.user.findUniqueOrThrow({
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
    const cloudProjectCount = await prisma_1.prisma.midiProject.count({ where: { ownerId: userId } });
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
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { midiSavesDayKey: true, midiSavesToday: true },
    });
    if (!user)
        return;
    if (user.midiSavesDayKey !== dayKey) {
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { midiSavesDayKey: dayKey, midiSavesToday: 1 },
        });
    }
    else {
        await prisma_1.prisma.user.update({
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
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { tokenBalance: true },
    });
    if (!user || user.tokenBalance < plans_1.TOKENS_PER_GENERATION) {
        const err = new Error(`Недостаточно токенов (нужно ${plans_1.TOKENS_PER_GENERATION}). Купите пакет токенов или обновите подписку.`);
        err.status = 402;
        err.code = 'AI_TOKENS_EMPTY';
        throw err;
    }
    const updated = await prisma_1.prisma.user.update({
        where: { id: userId },
        data: { tokenBalance: { decrement: plans_1.TOKENS_PER_GENERATION } },
        select: { tokenBalance: true },
    });
    return updated.tokenBalance;
}
async function fulfillPayment(paymentId) {
    const payment = await prisma_1.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status === 'SUCCEEDED')
        return false;
    let fulfilled = false;
    await prisma_1.prisma.$transaction(async (tx) => {
        const locked = await tx.payment.findUnique({ where: { id: paymentId } });
        if (!locked || locked.status === 'SUCCEEDED')
            return;
        await tx.payment.update({
            where: { id: paymentId },
            data: { status: 'SUCCEEDED' },
        });
        fulfilled = true;
        if ((0, plans_1.isTokenPackKind)(locked.kind)) {
            await tx.user.update({
                where: { id: locked.userId },
                data: { tokenBalance: { increment: plans_1.TOKEN_PACKS[locked.kind].tokens } },
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
    if (fulfilled) {
        const full = await prisma_1.prisma.payment.findUnique({
            where: { id: paymentId },
            include: { user: { select: { username: true, email: true } } },
        });
        if (full) {
            const { sendAdminNotification } = await Promise.resolve().then(() => __importStar(require('./emailService')));
            void sendAdminNotification('Оплата прошла', [
                `User: @${full.user.username} (${full.user.email})`,
                `Kind: ${full.kind}`,
                `Amount: ${full.amountRub} ₽`,
                `Payment: ${full.id}`,
                `YooKassa: ${full.yookassaPaymentId || '—'}`,
            ].join('\n'));
        }
    }
    return fulfilled;
}
async function markPaymentCanceled(paymentId) {
    await prisma_1.prisma.payment.updateMany({
        where: { id: paymentId, status: { not: 'SUCCEEDED' } },
        data: { status: 'CANCELED' },
    });
}
//# sourceMappingURL=planService.js.map