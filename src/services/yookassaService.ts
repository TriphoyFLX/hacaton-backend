import crypto from 'crypto';
import { PrismaClient, PaymentKind } from '@prisma/client';
import { productForKind, type PaymentProductKind } from '../config/plans';
import { fulfillPayment, markPaymentCanceled } from './planService';

const prisma = new PrismaClient();

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

/** Handle YooKassa webhook notification object. */
export async function handleYooKassaWebhook(notification: any): Promise<void> {
  const event = notification?.event;
  const obj = notification?.object;
  if (!obj?.id) return;

  const payment = await prisma.payment.findFirst({
    where: { yookassaPaymentId: String(obj.id) },
  });
  if (!payment) {
    // Fallback: metadata.paymentId
    const metaId = obj?.metadata?.paymentId;
    if (!metaId) return;
    const byMeta = await prisma.payment.findUnique({ where: { id: String(metaId) } });
    if (!byMeta) return;
    if (event === 'payment.succeeded' || obj.status === 'succeeded') {
      await fulfillPayment(byMeta.id);
    } else if (event === 'payment.canceled' || obj.status === 'canceled') {
      await markPaymentCanceled(byMeta.id);
    }
    return;
  }

  if (event === 'payment.succeeded' || obj.status === 'succeeded') {
    await fulfillPayment(payment.id);
  } else if (event === 'payment.canceled' || obj.status === 'canceled') {
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
