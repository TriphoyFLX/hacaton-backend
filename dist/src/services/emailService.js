"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVerificationEmail = sendVerificationEmail;
exports.sendAdminNotification = sendAdminNotification;
exports.createVerificationPayload = createVerificationPayload;
exports.isEmailConfigured = isEmailConfigured;
const nodemailer_1 = __importDefault(require("nodemailer"));
function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
function noreplyFrom() {
    return process.env.EMAIL_FROM || process.env.SMTP_FROM || 'SoundLab <noreply@soundlab-studio.ru>';
}
function placementFrom() {
    return process.env.EMAIL_FROM_PLACEMENT || 'SoundLab Placement <placement@soundlab-studio.ru>';
}
function notificationTo() {
    return process.env.NOTIFICATION_EMAIL || null;
}
function emailHtml(code) {
    return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#111;color:#f0ede8;border-radius:12px">
      <h2 style="margin:0 0 12px">SoundLab</h2>
      <p style="color:#aaa;margin:0 0 20px">Код подтверждения email</p>
      <div style="font-size:32px;letter-spacing:8px;font-weight:700;padding:16px 24px;background:#1a1a1a;border-radius:8px;text-align:center">${code}</div>
      <p style="color:#666;font-size:13px;margin:20px 0 0">Код действует 15 минут. Если вы не регистрировались — игнорируйте это письмо.</p>
    </div>
  `;
}
function emailText(code) {
    return `Ваш код подтверждения: ${code}\n\nКод действует 15 минут.\nЕсли вы не регистрировались на SoundLab — просто игнорируйте письмо.`;
}
function getTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
        return null;
    }
    return nodemailer_1.default.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user, pass },
    });
}
async function sendMail(opts) {
    const to = Array.isArray(opts.to) ? opts.to : [opts.to];
    if (process.env.RESEND_API_KEY) {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: opts.from,
                to,
                subject: opts.subject,
                html: opts.html,
                text: opts.text,
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Resend failed (${res.status}): ${body}`);
        }
        return;
    }
    const transporter = getTransporter();
    if (!transporter) {
        console.warn(`[email] No mail provider. Would send to ${to.join(', ')}: ${opts.subject}\n${opts.text}`);
        return;
    }
    await transporter.sendMail({
        from: opts.from,
        to: to.join(', '),
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
    });
}
async function sendVerificationEmail(email, code) {
    await sendMail({
        from: noreplyFrom(),
        to: email,
        subject: 'Код подтверждения SoundLab',
        text: emailText(code),
        html: emailHtml(code),
    });
}
async function sendAdminNotification(subject, text) {
    const to = notificationTo();
    if (!to) {
        console.warn(`[email] NOTIFICATION_EMAIL not set. Skip: ${subject}`);
        return;
    }
    try {
        await sendMail({
            from: placementFrom(),
            to,
            subject: `[SoundLab] ${subject}`,
            text,
            html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#111;color:#f0ede8;border-radius:12px">
          <h2 style="margin:0 0 8px">SoundLab</h2>
          <p style="color:#888;margin:0 0 16px;font-size:13px">${subject}</p>
          <pre style="white-space:pre-wrap;font-family:inherit;background:#1a1a1a;padding:16px;border-radius:8px;margin:0">${text}</pre>
        </div>
      `,
        });
    }
    catch (e) {
        console.error('[email] Admin notification failed:', e);
    }
}
function createVerificationPayload() {
    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    return { code, expires };
}
function isEmailConfigured() {
    return Boolean(process.env.RESEND_API_KEY ||
        (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
}
//# sourceMappingURL=emailService.js.map