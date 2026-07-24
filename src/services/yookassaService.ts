import crypto from 'crypto';
import { PaymentKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { productForKind, type PaymentProductKind } from '../config/plans';
import { fulfillPayment, markPaymentCanceled } from './planService';


function shopId() {
  return process.env.YOOKASSA_SHOP_ID || '';
}

function secretKey() {
  return process.env.YOOKASSA_SECRET_KEY || '';
}

export function isYooKassaConfigured(): boolean {
  return Boolean(shopId() && secretKey());
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${shopId()}:${secretKey()}`).toString('base64')}`;
}

export async function createYooKassaPayment(opts: {
  userId: string;
  kind: PaymentProductKind;
  returnUrl: string;
}) {
  if (!isYooKassaConfigured()) {
    const err: any = new Error('YooKassa is not configured');
    err.status = 503;
    throw err;
  }

  const product = productForKind(opts.kind);
  const payment = await prisma.payment.create({
    data: {
      userId: opts.userId,
      kind: opts.kind as PaymentKind,
      amountRub: product.amountRub,
      description: product.description,
      status: 'PENDING',
      metadata: { returnUrl: opts.returnUrl },
    },
  });

  const idempotenceKey = crypto.randomUUID();
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

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELED', metadata: { error: data } },
    });
    const err: any = new Error(data?.description || data?.message || 'YooKassa create payment failed');
    err.status = 502;
    err.details = data;
    throw err;
  }

  const confirmationUrl = data?.confirmation?.confirmation_url as string | undefined;
  await prisma.payment.update({
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
    yookassaPaymentId: data.id as string,
    confirmationUrl: confirmationUrl || null,
    amountRub: product.amountRub,
    kind: opts.kind,
  };
}

/**
 * Handle YooKassa HTTP notification.
 * Never trust the payload alone — re-fetch payment status from YooKassa API
 * before fulfilling (prevents forged "payment.succeeded" webhooks).
 */
export async function handleYooKassaWebhook(notification: any): Promise<void> {
  if (!isYooKassaConfigured()) {
    throw Object.assign(new Error('YooKassa is not configured'), { status: 503 });
  }

  const event = typeof notification?.event === 'string' ? notification.event : '';
  const obj = notification?.object;
  const yookassaId = obj?.id ? String(obj.id) : '';
  if (!yookassaId || yookassaId.length > 128) return;

  // Only process payment lifecycle events we care about
  if (event && !event.startsWith('payment.')) return;

  let payment = await prisma.payment.findFirst({
    where: { yookassaPaymentId: yookassaId },
  });

  if (!payment) {
    const metaId = obj?.metadata?.paymentId ? String(obj.metadata.paymentId) : '';
    if (!metaId || metaId.length > 64) return;
    payment = await prisma.payment.findUnique({ where: { id: metaId } });
    if (!payment) return;
    // Bind yookassa id if missing (first notification)
    if (!payment.yookassaPaymentId) {
      payment = await prisma.payment.update({
        where: { id: payment.id },
        data: { yookassaPaymentId: yookassaId },
      });
    } else if (payment.yookassaPaymentId !== yookassaId) {
      console.warn('[yookassa] webhook id mismatch for payment', payment.id);
      return;
    }
  }

  if (payment.status === 'SUCCEEDED' || payment.status === 'CANCELED') return;

  const res = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(yookassaId)}`, {
    headers: { Authorization: authHeader() },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn('[yookassa] webhook verify failed', res.status, data?.description || data?.code);
    throw Object.assign(new Error('Unable to verify payment with YooKassa'), { status: 502 });
  }

  const status = String(data.status || '');
  if (status === 'succeeded') {
    await fulfillPayment(payment.id);
  } else if (status === 'canceled') {
    await markPaymentCanceled(payment.id);
  }
}

/** Poll YooKassa for a payment owned by the user (return-url fallback). */
export async function syncPaymentStatus(userId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId },
  });
  if (!payment) {
    const err: any = new Error('Payment not found');
    err.status = 404;
    throw err;
  }
  if (payment.status === 'SUCCEEDED') return payment;
  if (!payment.yookassaPaymentId || !isYooKassaConfigured()) return payment;

  const res = await fetch(`https://api.yookassa.ru/v3/payments/${payment.yookassaPaymentId}`, {
    headers: { Authorization: authHeader() },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) return payment;

  if (data.status === 'succeeded') {
    await fulfillPayment(payment.id);
  } else if (data.status === 'canceled') {
    await markPaymentCanceled(payment.id);
  }

  return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
}
