"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isYooKassaConfigured = isYooKassaConfigured;
exports.createYooKassaPayment = createYooKassaPayment;
exports.handleYooKassaWebhook = handleYooKassaWebhook;
exports.syncPaymentStatus = syncPaymentStatus;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const plans_1 = require("../config/plans");
const planService_1 = require("./planService");
function shopId() {
    return process.env.YOOKASSA_SHOP_ID || '';
}
function secretKey() {
    return process.env.YOOKASSA_SECRET_KEY || '';
}
function isYooKassaConfigured() {
    return Boolean(shopId() && secretKey());
}
function authHeader() {
    return `Basic ${Buffer.from(`${shopId()}:${secretKey()}`).toString('base64')}`;
}
async function createYooKassaPayment(opts) {
    if (!isYooKassaConfigured()) {
        const err = new Error('YooKassa is not configured');
        err.status = 503;
        throw err;
    }
    const product = (0, plans_1.productForKind)(opts.kind);
    const payment = await prisma_1.prisma.payment.create({
        data: {
            userId: opts.userId,
            kind: opts.kind,
            amountRub: product.amountRub,
            description: product.description,
            status: 'PENDING',
            metadata: { returnUrl: opts.returnUrl },
        },
    });
    const idempotenceKey = crypto_1.default.randomUUID();
    const body = {
        amount: {
            value: product.amountRub.toFixed(2),
            currency: 'RUB',
        },
        confirmation: {
            type: 'redirect',
            return_url: opts.returnUrl,
        },
        capture: true,
        description: product.description.slice(0, 128),
        metadata: {
            paymentId: payment.id,
            userId: opts.userId,
            kind: opts.kind,
        },
    };
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/json',
            'Idempotence-Key': idempotenceKey,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        await prisma_1.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'CANCELED', metadata: { error: data } },
        });
        const err = new Error(data?.description || data?.message || 'YooKassa create payment failed');
        err.status = 502;
        err.details = data;
        throw err;
    }
    const confirmationUrl = data?.confirmation?.confirmation_url;
    await prisma_1.prisma.payment.update({
        where: { id: payment.id },
        data: {
            yookassaPaymentId: data.id,
            confirmationUrl: confirmationUrl || null,
            status: data.status === 'waiting_for_capture' ? 'WAITING_FOR_CAPTURE' : 'PENDING',
            metadata: { yookassa: { id: data.id, status: data.status } },
        },
    });
    return {
        paymentId: payment.id,
        yookassaPaymentId: data.id,
        confirmationUrl: confirmationUrl || null,
        amountRub: product.amountRub,
        kind: opts.kind,
    };
}
async function handleYooKassaWebhook(notification) {
    const event = notification?.event;
    const obj = notification?.object;
    if (!obj?.id)
        return;
    const payment = await prisma_1.prisma.payment.findFirst({
        where: { yookassaPaymentId: String(obj.id) },
    });
    if (!payment) {
        const metaId = obj?.metadata?.paymentId;
        if (!metaId)
            return;
        const byMeta = await prisma_1.prisma.payment.findUnique({ where: { id: String(metaId) } });
        if (!byMeta)
            return;
        if (event === 'payment.succeeded' || obj.status === 'succeeded') {
            await (0, planService_1.fulfillPayment)(byMeta.id);
        }
        else if (event === 'payment.canceled' || obj.status === 'canceled') {
            await (0, planService_1.markPaymentCanceled)(byMeta.id);
        }
        return;
    }
    if (event === 'payment.succeeded' || obj.status === 'succeeded') {
        await (0, planService_1.fulfillPayment)(payment.id);
    }
    else if (event === 'payment.canceled' || obj.status === 'canceled') {
        await (0, planService_1.markPaymentCanceled)(payment.id);
    }
}
async function syncPaymentStatus(userId, paymentId) {
    const payment = await prisma_1.prisma.payment.findFirst({
        where: { id: paymentId, userId },
    });
    if (!payment) {
        const err = new Error('Payment not found');
        err.status = 404;
        throw err;
    }
    if (payment.status === 'SUCCEEDED')
        return payment;
    if (!payment.yookassaPaymentId || !isYooKassaConfigured())
        return payment;
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${payment.yookassaPaymentId}`, {
        headers: { Authorization: authHeader() },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        return payment;
    if (data.status === 'succeeded') {
        await (0, planService_1.fulfillPayment)(payment.id);
    }
    else if (data.status === 'canceled') {
        await (0, planService_1.markPaymentCanceled)(payment.id);
    }
    return prisma_1.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
}
//# sourceMappingURL=yookassaService.js.map