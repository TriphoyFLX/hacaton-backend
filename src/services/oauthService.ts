import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendAdminNotification } from './emailService';


export function frontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

export function backendUrl(): string {
  return (process.env.BACKEND_URL || process.env.PUBLIC_API_URL || 'http://localhost:5002').replace(/\/$/, '');
}

export function oauthState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function googleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = `${backendUrl()}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string): Promise<{
  email: string;
  name?: string;
  picture?: string;
  googleId: string;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${backendUrl()}/api/auth/google/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const tokens = await tokenRes.json() as { access_token: string };
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!profileRes.ok) {
    throw new Error('Failed to fetch Google profile');
  }

  const profile = await profileRes.json() as {
    id: string;
    email: string;
    name?: string;
    picture?: string;
    verified_email?: boolean;
  };

  if (!profile.email) {
    throw new Error('Google account has no email');
  }
  if (profile.verified_email !== true) {
    throw new Error('Google account email is not verified');
  }

  return {
    email: profile.email.toLowerCase(),
    name: profile.name,
    picture: profile.picture,
    googleId: profile.id,
  };
}

export function vkAuthUrl(state: string): string {
  const clientId = process.env.VK_CLIENT_ID!;
  const redirectUri = `${backendUrl()}/api/auth/vk/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'email',
    state,
    v: '5.199',
  });
  return `https://oauth.vk.com/authorize?${params}`;
}

export async function exchangeVkCode(code: string): Promise<{
  email: string;
  name?: string;
  picture?: string;
  vkId: string;
}> {
  const clientId = process.env.VK_CLIENT_ID!;
  const clientSecret = process.env.VK_CLIENT_SECRET!;
  const redirectUri = `${backendUrl()}/api/auth/vk/callback`;

  const tokenRes = await fetch(
    `https://oauth.vk.com/access_token?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    })}`
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`VK token exchange failed: ${err}`);
  }

  const tokens = await tokenRes.json() as {
    access_token?: string;
    user_id?: number;
    email?: string;
    error?: string;
    error_description?: string;
  };

  if (tokens.error || !tokens.access_token || !tokens.user_id) {
    throw new Error(tokens.error_description || tokens.error || 'VK auth failed');
  }

  const profileRes = await fetch(
    `https://api.vk.com/method/users.get?${new URLSearchParams({
      access_token: tokens.access_token,
      user_ids: String(tokens.user_id),
      fields: 'photo_200',
      v: '5.199',
    })}`
  );

  const profileJson = await profileRes.json() as {
    response?: Array<{ id: number; first_name?: string; last_name?: string; photo_200?: string }>;
    error?: { error_msg?: string };
  };

  if (profileJson.error || !profileJson.response?.[0]) {
    throw new Error(profileJson.error?.error_msg || 'Failed to fetch VK profile');
  }

  const u = profileJson.response[0];
  const email = (tokens.email || `vk_${tokens.user_id}@vk.soundlab.local`).toLowerCase();
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || undefined;

  return {
    email,
    name,
    picture: u.photo_200,
    vkId: String(tokens.user_id),
  };
}

function slugifyUsername(base: string): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  return cleaned || 'user';
}

export async function findOrCreateOAuthUser(input: {
  email: string;
  name?: string;
  picture?: string;
  googleId?: string;
  vkId?: string;
}) {
  const email = input.email.toLowerCase();

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        ...(input.googleId ? [{ googleId: input.googleId }] : []),
        ...(input.vkId ? [{ vkId: input.vkId }] : []),
      ],
    },
  });

  if (user) {
    const discardUnverifiedPassword = !user.emailVerified && Boolean(user.password);
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        ...(discardUnverifiedPassword ? {
          password: null,
          emailVerificationCode: null,
          emailVerificationExpires: null,
        } : {}),
        ...(input.googleId && !user.googleId ? { googleId: input.googleId } : {}),
        ...(input.vkId && !user.vkId ? { vkId: input.vkId } : {}),
        ...(input.picture && !user.avatar ? { avatar: input.picture } : {}),
        ...(input.name && !user.displayName ? { displayName: input.name } : {}),
      },
    });
    return user;
  }

  const base = slugifyUsername(input.name || email.split('@')[0]);
  let username = base;
  let attempt = 0;
  while (await prisma.user.findUnique({ where: { username } })) {
    attempt += 1;
    username = `${base}${attempt}`.slice(0, 30);
  }

  // Default birth date: 18 years ago (OAuth skips DOB form)
  const birthDate = new Date();
  birthDate.setFullYear(birthDate.getFullYear() - 18);

  user = await prisma.user.create({
    data: {
      email,
      username,
      password: null,
      birthDate,
      agreedToTerms: true,
      emailVerified: true,
      googleId: input.googleId,
      vkId: input.vkId,
      displayName: input.name,
      avatar: input.picture,
    },
  });

  const via = input.googleId ? 'Google' : input.vkId ? 'VK' : 'OAuth';
  void sendAdminNotification(
    `Новый пользователь (${via})`,
    `Username: ${username}\nEmail: ${email}\nПровайдер: ${via}`,
  );

  return user;
}
