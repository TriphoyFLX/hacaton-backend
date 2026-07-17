import nodemailer from 'nodemailer';

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
}

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@soundlab-studio.ru';
  const transporter = getTransporter();

  if (!transporter) {
    // Dev fallback — log code so local testing still works
    console.warn(`[email] SMTP not configured. Verification code for ${email}: ${code}`);
    return;
  }

  await transporter.sendMail({
    from: `"SoundLab" <${from}>`,
    to: email,
    subject: 'Код подтверждения SoundLab',
    text: `Ваш код подтверждения: ${code}\n\nКод действует 15 минут.\nЕсли вы не регистрировались на SoundLab — просто игнорируйте письмо.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#111;color:#f0ede8;border-radius:12px">
        <h2 style="margin:0 0 12px">SoundLab</h2>
        <p style="color:#aaa;margin:0 0 20px">Код подтверждения email</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:700;padding:16px 24px;background:#1a1a1a;border-radius:8px;text-align:center">${code}</div>
        <p style="color:#666;font-size:13px;margin:20px 0 0">Код действует 15 минут. Если вы не регистрировались — игнорируйте это письмо.</p>
      </div>
    `,
  });
}

export function createVerificationPayload() {
  const code = generateCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  return { code, expires };
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
