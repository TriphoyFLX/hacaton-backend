import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { createServer } from 'http';
import { createProfileRouter } from './src/routes/profileRoutes';
import { createFollowRouter } from './src/routes/followRoutes';
import { createPresetRouter } from './src/routes/presetRoutes';
import {
  createVerificationPayload,
  hashVerificationCode,
  isEmailConfigured,
  sendVerificationEmail,
  sendAdminNotification,
  verifyVerificationCode,
} from './src/services/emailService';
import {
  getBillingSnapshot,
  assertCanCreateMidiProject,
  recordMidiCloudSave,
  consumeAiGenerationTokens,
} from './src/services/planService';
import {
  createYooKassaPayment,
  handleYooKassaWebhook,
  syncPaymentStatus,
  isYooKassaConfigured,
} from './src/services/yookassaService';
import { PLAN_CATALOG, TOKEN_PACKS, TOKENS_PER_GENERATION } from './src/config/plans';
import { applyBattleEloResult } from './src/services/battleEloService';
import { BATTLE_ELO_DEFAULT, battleRatingPayload, getBattleRank } from './src/services/battleRating';
import {
  exchangeGoogleCode,
  exchangeVkCode,
  findOrCreateOAuthUser,
  frontendUrl,
  googleAuthUrl,
  oauthState,
  vkAuthUrl,
  vkPkce,
} from './src/services/oauthService';
import { createChatRouter } from './src/routes/chatRoutes';
import { configureChatUploadsDir } from './src/services/chatService';
import { createBlockRouter } from './src/routes/blockRoutes';
import { createSocketServer, getUserOnlineStatus } from './src/websocket/socketServer';
import { notificationService } from './src/services/notificationService';
import { rateLimitMiddleware } from './src/utils/rateLimiter';
import { corsOptions, requireJwtSecret, securityHeaders } from './src/middleware/security';
import { compressionMiddleware } from './src/middleware/compression';
import { validateMessageContent } from './src/utils/messageValidation';
import { sanitizeUserText } from './src/utils/contentSanitize';
import {
  buildSafeUploadFilename,
  isAllowedAudioSample,
  isAllowedUploadFile,
  mediaKindFromExt,
  safeUploadExtension,
} from './src/utils/safeUpload';
import { prisma } from './src/lib/prisma';

dotenv.config();
const JWT_SECRET = requireJwtSecret();
/** Used so login always does a bcrypt compare (mitigates user-enumeration timing). */
const LOGIN_DUMMY_HASH = bcrypt.hashSync('soundlab-timing-dummy-v1', 12);
const app = express();
const isProd = process.env.NODE_ENV === 'production';
const debugLog = (...args: unknown[]) => {
  if (!isProd) console.log(...args);
};

// Behind nginx — trust X-Forwarded-For for rate limits / logs
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
configureChatUploadsDir(uploadsDir);
const privatePresetsDir = path.join(__dirname, 'private-presets');
if (!fs.existsSync(privatePresetsDir)) {
  fs.mkdirSync(privatePresetsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const safe = buildSafeUploadFilename(file.originalname);
    if (!safe) {
      return cb(new Error('Invalid file type'), '');
    }
    cb(null, safe);
  },
});

const SOUNDTOK_MAX_BYTES = 15 * 1024 * 1024; // 15MB — matches SoundTok UI

const upload = multer({
  storage,
  limits: {
    fileSize: SOUNDTOK_MAX_BYTES,
    files: 10,
  },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (isAllowedUploadFile(file.originalname, file.mimetype)) {
      return cb(null, true);
    }
    console.warn('Rejected upload:', file.originalname, file.mimetype);
    cb(new Error('Invalid file type'));
  },
});

const MIDI_SAMPLE_MAX_BYTES = 6 * 1024 * 1024;
const midiSampleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MIDI_SAMPLE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAudioSample(file.originalname, file.mimetype)) {
      console.warn('Rejected midi sample:', file.originalname, 'mimetype:', file.mimetype);
      return cb(new Error('Only audio files are allowed'));
    }
    cb(null, true);
  },
});

const receiveMidiSample = (req: Request, res: Response, next: NextFunction) => {
  midiSampleUpload.single('sample')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Sample must not exceed 6 MB' });
    }
    console.warn('midi sample upload error:', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid sample' });
  });
};

app.use(securityHeaders);
app.use(cors(corsOptions()));
app.use(compressionMiddleware);
app.use(express.json({ limit: '5mb' }));
app.use(
  '/uploads',
  express.static(uploadsDir, {
    maxAge: isProd ? '7d' : 0,
    etag: true,
    lastModified: true,
    immutable: false,
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      // Never execute uploaded content as scripts
      if (/\.(jpe?g|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|flac|m4a|aac)$/i.test(filePath)) {
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    },
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const authRateLimit = rateLimitMiddleware({
  keyPrefix: 'auth',
  max: 20,
  windowMs: 15 * 60 * 1000,
  message: 'Too many auth attempts. Try again in a few minutes.',
});
const authStrictRateLimit = rateLimitMiddleware({
  keyPrefix: 'auth-strict',
  max: 8,
  windowMs: 15 * 60 * 1000,
  message: 'Too many login attempts. Try again later.',
});
const adminRateLimit = rateLimitMiddleware({
  keyPrefix: 'admin',
  max: 60,
  windowMs: 60 * 1000,
  message: 'Too many admin requests. Slow down.',
});
const generalApiRateLimit = rateLimitMiddleware({
  keyPrefix: 'api',
  max: 600,
  windowMs: 60 * 1000,
  message: 'Rate limit exceeded',
});
const feedbackRateLimit = rateLimitMiddleware({
  keyPrefix: 'pwa-feedback',
  max: 8,
  windowMs: 60 * 60 * 1000,
  message: 'Too many feedback submissions. Try again later.',
});
const uploadRateLimit = rateLimitMiddleware({
  keyPrefix: 'upload',
  max: 40,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много загрузок подряд. Подождите немного и попробуйте снова',
});
const searchRateLimit = rateLimitMiddleware({
  keyPrefix: 'search',
  max: 60,
  windowMs: 60 * 1000,
  message: 'Too many searches. Slow down.',
});
const aiRateLimit = rateLimitMiddleware({
  keyPrefix: 'ai-gen',
  max: 20,
  windowMs: 60 * 60 * 1000,
  message: 'Too many AI generations. Try again later.',
});
const webhookRateLimit = rateLimitMiddleware({
  keyPrefix: 'billing-webhook',
  max: 120,
  windowMs: 60 * 1000,
  message: 'Too many webhook calls',
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return generalApiRateLimit(req, res, next);
});
app.use('/api/admin', adminRateLimit);

const userPublicSelect = {
  id: true,
  username: true,
  email: true,
  birthDate: true,
  agreedToTerms: true,
  role: true,
  emailVerified: true,
  displayName: true,
  avatar: true,
  plan: true,
  planExpiresAt: true,
  tokenBalance: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Lean author card for feeds / comments — includes role for admin badge and plan for Platinum. */
const authorPreviewSelect = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  role: true,
  plan: true,
  planExpiresAt: true,
} as const;

const HIDDEN_COMMENT_TEXT = 'Вы скрыли этот комментарий';

type CommentVoteRow = { type: 'LIKE' | 'DISLIKE' };

function mapCommentWithVotes<T extends {
  text: string;
  likes: number;
  dislikes: number;
  votes?: CommentVoteRow[];
}>(comment: T) {
  const myVote = comment.votes?.[0]?.type ?? null;
  const isHidden = myVote === 'DISLIKE';
  const { votes: _votes, ...rest } = comment;
  return {
    ...rest,
    text: isHidden ? HIDDEN_COMMENT_TEXT : comment.text,
    likes: comment.likes ?? 0,
    dislikes: comment.dislikes ?? 0,
    isLiked: myVote === 'LIKE',
    isDisliked: isHidden,
    isHidden,
  };
}

async function setPostCommentVote(userId: string, commentId: string, type: 'LIKE' | 'DISLIKE' | null) {
  const comment = await prisma.postComment.findUnique({
    where: { id: commentId },
    select: { id: true, likes: true, dislikes: true },
  });
  if (!comment) return null;

  const existing = await prisma.postCommentVote.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });

  let likes = comment.likes;
  let dislikes = comment.dislikes;

  if (!type) {
    if (!existing) {
      return { likes, dislikes, isLiked: false, isDisliked: false, isHidden: false };
    }
    if (existing.type === 'LIKE') likes = Math.max(0, likes - 1);
    if (existing.type === 'DISLIKE') dislikes = Math.max(0, dislikes - 1);
    await prisma.$transaction([
      prisma.postCommentVote.delete({ where: { id: existing.id } }),
      prisma.postComment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
    return { likes, dislikes, isLiked: false, isDisliked: false, isHidden: false };
  }

  if (!existing) {
    if (type === 'LIKE') likes += 1;
    else dislikes += 1;
    await prisma.$transaction([
      prisma.postCommentVote.create({ data: { userId, commentId, type } }),
      prisma.postComment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
  } else if (existing.type === type) {
    if (type === 'LIKE') likes = Math.max(0, likes - 1);
    else dislikes = Math.max(0, dislikes - 1);
    await prisma.$transaction([
      prisma.postCommentVote.delete({ where: { id: existing.id } }),
      prisma.postComment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
    return { likes, dislikes, isLiked: false, isDisliked: false, isHidden: false };
  } else {
    if (type === 'LIKE') {
      likes += 1;
      dislikes = Math.max(0, dislikes - 1);
    } else {
      dislikes += 1;
      likes = Math.max(0, likes - 1);
    }
    await prisma.$transaction([
      prisma.postCommentVote.update({ where: { id: existing.id }, data: { type } }),
      prisma.postComment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
  }

  const isDisliked = type === 'DISLIKE';
  return { likes, dislikes, isLiked: type === 'LIKE', isDisliked, isHidden: isDisliked };
}

async function setSoundTokCommentVote(userId: string, commentId: string, type: 'LIKE' | 'DISLIKE' | null) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, likes: true, dislikes: true },
  });
  if (!comment) return null;

  const existing = await prisma.commentVote.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });

  let likes = comment.likes;
  let dislikes = comment.dislikes;

  if (!type) {
    if (!existing) {
      return { likes, dislikes, isLiked: false, isDisliked: false, isHidden: false };
    }
    if (existing.type === 'LIKE') likes = Math.max(0, likes - 1);
    if (existing.type === 'DISLIKE') dislikes = Math.max(0, dislikes - 1);
    await prisma.$transaction([
      prisma.commentVote.delete({ where: { id: existing.id } }),
      prisma.comment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
    return { likes, dislikes, isLiked: false, isDisliked: false, isHidden: false };
  }

  if (!existing) {
    if (type === 'LIKE') likes += 1;
    else dislikes += 1;
    await prisma.$transaction([
      prisma.commentVote.create({ data: { userId, commentId, type } }),
      prisma.comment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
  } else if (existing.type === type) {
    if (type === 'LIKE') likes = Math.max(0, likes - 1);
    else dislikes = Math.max(0, dislikes - 1);
    await prisma.$transaction([
      prisma.commentVote.delete({ where: { id: existing.id } }),
      prisma.comment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
    return { likes, dislikes, isLiked: false, isDisliked: false, isHidden: false };
  } else {
    if (type === 'LIKE') {
      likes += 1;
      dislikes = Math.max(0, dislikes - 1);
    } else {
      dislikes += 1;
      likes = Math.max(0, likes - 1);
    }
    await prisma.$transaction([
      prisma.commentVote.update({ where: { id: existing.id }, data: { type } }),
      prisma.comment.update({ where: { id: commentId }, data: { likes, dislikes } }),
    ]);
  }

  const isDisliked = type === 'DISLIKE';
  return { likes, dislikes, isLiked: type === 'LIKE', isDisliked, isHidden: isDisliked };
}

const REPORT_REASONS = [
  'BULLYING',
  'SCAM',
  'SPAM',
  'HARASSMENT',
  'HATE',
  'IMPERSONATION',
  'OTHER',
] as const;

const REPORT_STATUSES = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'] as const;
const REPORT_REASONS_REQUIRING_DETAILS = new Set<(typeof REPORT_REASONS)[number]>([
  'SCAM',
  'OTHER',
]);

function signAuthToken(userId: string, role?: string) {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign(
    { userId, ...(role ? { role } : {}) },
    JWT_SECRET,
    { expiresIn }
  );
}

const OAUTH_STATE_COOKIE = 'soundlab_oauth_state';
const VK_PKCE_COOKIE = 'soundlab_vk_pkce';

function parseCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

function setOAuthStateCookie(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/api/auth',
  });
}

function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
  });
}

function setVkPkceCookie(res: Response, verifier: string): void {
  res.cookie(VK_PKCE_COOKIE, verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/api/auth',
  });
}

function clearVkPkceCookie(res: Response): void {
  res.clearCookie(VK_PKCE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
  });
}

function hasValidOAuthState(req: Request, providedState?: string): boolean {
  const queryState = providedState
    ?? (typeof req.query.state === 'string' ? req.query.state : '');
  const cookieState = parseCookie(req, OAUTH_STATE_COOKIE) || '';
  const queryBuffer = Buffer.from(queryState);
  const cookieBuffer = Buffer.from(cookieState);
  return queryBuffer.length > 0
    && queryBuffer.length === cookieBuffer.length
    && crypto.timingSafeEqual(queryBuffer, cookieBuffer);
}

function vkCallbackParams(req: Request): {
  code: string;
  state: string;
  deviceId: string;
  error: string;
} {
  let source: Record<string, unknown> = req.query;
  if (typeof req.query.payload === 'string') {
    const payload = JSON.parse(req.query.payload) as unknown;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      source = payload as Record<string, unknown>;
    }
  }
  const value = (key: string) => typeof source[key] === 'string' ? source[key] as string : '';
  return {
    code: value('code'),
    state: value('state'),
    deviceId: value('device_id'),
    error: value('error') || value('error_description'),
  };
}

function isVkOAuthConfigured(): boolean {
  return Boolean(
    process.env.VK_CLIENT_ID
    && (process.env.VK_SERVICE_TOKEN || process.env.VK_CLIENT_SECRET),
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    const { username, email, password, birthDate, agreedToTerms } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!username || !normalizedEmail || !password || !birthDate || !agreedToTerms) {
      return res.status(400).json({
        error: 'Заполните все поля и примите условия использования',
      });
    }
    if (!isEmailConfigured()) {
      return res.status(503).json({
        error: 'Почта временно недоступна. Попробуйте чуть позже',
      });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        error: 'Проверьте email — похоже, он написан неправильно',
      });
    }

    if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 30) {
      return res.status(400).json({
        error: 'Имя пользователя — от 3 до 30 символов',
      });
    }

    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: 'Пароль должен быть от 8 до 128 символов',
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username },
        ],
      },
      select: {
        id: true,
        email: true,
        username: true,
        emailVerified: true,
      },
    });

    if (existingUser) {
      // Allow re-registration attempt for unverified accounts with same email
      if (existingUser.email === normalizedEmail && !existingUser.emailVerified) {
        const { code, expires } = createVerificationPayload();
        const hashedPassword = await bcrypt.hash(password, 12);
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            username,
            password: hashedPassword,
            birthDate: new Date(birthDate),
            agreedToTerms: Boolean(agreedToTerms),
            emailVerificationCode: hashVerificationCode(code),
            emailVerificationExpires: expires,
          },
        });
        await sendVerificationEmail(normalizedEmail, code);
        return res.status(200).json({
          requiresVerification: true,
          email: normalizedEmail,
          message: 'Код подтверждения отправлен на email',
        });
      }
      if (existingUser.email === normalizedEmail) {
        return res.status(400).json({
          error: 'Этот email уже зарегистрирован. Войдите или восстановите доступ',
        });
      }
      return res.status(400).json({
        error: 'Это имя пользователя уже занято. Придумайте другое',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const { code, expires } = createVerificationPayload();

    await prisma.user.create({
      data: {
        username,
        email: normalizedEmail,
        password: hashedPassword,
        birthDate: new Date(birthDate),
        agreedToTerms: Boolean(agreedToTerms),
        emailVerified: false,
        emailVerificationCode: hashVerificationCode(code),
        emailVerificationExpires: expires,
      },
    });

    await sendVerificationEmail(normalizedEmail, code);
    void sendAdminNotification(
      'Новая регистрация',
      `Username: ${username}\nEmail: ${normalizedEmail}\nОжидает подтверждения email.`,
    );

    res.status(201).json({
      requiresVerification: true,
      email: normalizedEmail,
      message: 'Код подтверждения отправлен на email',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось зарегистрироваться. Попробуйте позже' });
  }
});

app.post('/api/auth/verify-email', authRateLimit, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

    if (!email || !code) {
      return res.status(400).json({ error: 'Введите email и код из письма' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (user.emailVerified) {
      const token = signAuthToken(user.id, user.role);
      const publicUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: userPublicSelect,
      });
      return res.json({ user: publicUser, token });
    }

    if (!user.emailVerificationCode || !verifyVerificationCode(user.emailVerificationCode, code)) {
      return res.status(400).json({ error: 'Неверный код. Проверьте письмо и попробуйте снова' });
    }

    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ error: 'Срок кода истёк. Запросите новый код' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationCode: null,
        emailVerificationExpires: null,
      },
      select: userPublicSelect,
    });

    void sendAdminNotification(
      'Email подтверждён',
      `Username: ${updated.username}\nEmail: ${updated.email}\nПользователь активирован.`,
    );

    const token = signAuthToken(updated.id, updated.role);
    res.json({ user: updated, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось подтвердить email. Попробуйте снова' });
  }
});

app.post('/api/auth/resend-code', authStrictRateLimit, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ error: 'Укажите email' });
    }
    if (!isEmailConfigured()) {
      return res.status(503).json({
        error: 'Почта временно недоступна. Попробуйте чуть позже',
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email уже подтверждён — можно войти' });
    }

    const { code, expires } = createVerificationPayload();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCode: hashVerificationCode(code),
        emailVerificationExpires: expires,
      },
    });
    await sendVerificationEmail(email, code);

    res.json({ message: 'Код отправлен повторно', email });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось отправить код. Попробуйте позже' });
  }
});

app.post('/api/auth/login', authStrictRateLimit, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password || password.length > 256) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        ...userPublicSelect,
        password: true,
      },
    });

    const hash = user?.password || LOGIN_DUMMY_HASH;
    const isValid = await bcrypt.compare(password, hash);
    if (!user || !user.password || !isValid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Сначала подтвердите email — мы отправили код на почту',
        requiresVerification: true,
        email: user.email,
      });
    }

    const token = signAuthToken(user.id, user.role);
    const { password: _, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось войти. Попробуйте позже' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: userPublicSelect,
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Email not verified', requiresVerification: true, email: user.email });
    }

    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/auth/providers', (_req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    vk: isVkOAuthConfigured(),
  });
});

app.get('/api/auth/google', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google OAuth is not configured' });
  }
  const state = oauthState();
  setOAuthStateCookie(res, state);
  res.redirect(googleAuthUrl(state));
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    if (!hasValidOAuthState(req)) {
      clearOAuthStateCookie(res);
      return res.redirect(`${frontendUrl()}/login?error=oauth_state`);
    }
    clearOAuthStateCookie(res);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      return res.redirect(`${frontendUrl()}/login?error=google_denied`);
    }
    const profile = await exchangeGoogleCode(code);
    const user = await findOrCreateOAuthUser({
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      googleId: profile.googleId,
    });
    const token = signAuthToken(user.id, user.role);
    res.redirect(`${frontendUrl()}/auth/callback#token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`${frontendUrl()}/login?error=google_failed`);
  }
});

app.get('/api/auth/vk', (_req, res) => {
  if (!isVkOAuthConfigured()) {
    return res.status(503).json({ error: 'VK OAuth is not configured' });
  }
  const state = oauthState();
  const { verifier, challenge } = vkPkce();
  setOAuthStateCookie(res, state);
  setVkPkceCookie(res, verifier);
  res.redirect(vkAuthUrl(state, challenge));
});

app.get('/api/auth/vk/callback', async (req, res) => {
  try {
    const callback = vkCallbackParams(req);
    const codeVerifier = parseCookie(req, VK_PKCE_COOKIE) || '';
    if (!hasValidOAuthState(req, callback.state) || !codeVerifier) {
      clearOAuthStateCookie(res);
      clearVkPkceCookie(res);
      return res.redirect(`${frontendUrl()}/login?error=oauth_state`);
    }
    clearOAuthStateCookie(res);
    clearVkPkceCookie(res);
    if (callback.error || !callback.code || !callback.deviceId) {
      return res.redirect(`${frontendUrl()}/login?error=vk_denied`);
    }
    const profile = await exchangeVkCode(
      callback.code,
      callback.deviceId,
      codeVerifier,
      callback.state,
    );
    const user = await findOrCreateOAuthUser({
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      vkId: profile.vkId,
    });
    const token = signAuthToken(user.id, user.role);
    res.redirect(`${frontendUrl()}/auth/callback#token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('VK OAuth error:', error);
    res.redirect(`${frontendUrl()}/login?error=vk_failed`);
  }
});

// Helper function to get user ID from token
const getUserFromToken = (authHeader?: string) => {
  if (!authHeader) return null;
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return decoded.userId;
  } catch {
    return null;
  }
};

const PWA_UNINSTALL_REASONS = [
  'bugs',
  'slow',
  'dont_need',
  'prefer_browser',
  'privacy',
  'other',
] as const;

const PWA_UNINSTALL_REASON_LABELS: Record<(typeof PWA_UNINSTALL_REASONS)[number], string> = {
  bugs: 'Были баги / глючило',
  slow: 'Работало медленно',
  dont_need: 'Пока не нужно',
  prefer_browser: 'Удобнее в обычном браузере',
  privacy: 'Вопросы к приватности',
  other: 'Другое',
};

app.post('/api/feedback/pwa-uninstall', feedbackRateLimit, async (req, res) => {
  try {
    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!PWA_UNINSTALL_REASONS.includes(reasonRaw as (typeof PWA_UNINSTALL_REASONS)[number])) {
      return res.status(400).json({ error: 'Invalid reason' });
    }
    const reason = reasonRaw as (typeof PWA_UNINSTALL_REASONS)[number];
    const details =
      typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 1000) : '';
    const userAgent =
      typeof req.body?.userAgent === 'string'
        ? req.body.userAgent.trim().slice(0, 400)
        : String(req.headers['user-agent'] || '').slice(0, 400);
    const platform =
      typeof req.body?.platform === 'string' ? req.body.platform.trim().slice(0, 80) : '';
    const language =
      typeof req.body?.language === 'string' ? req.body.language.trim().slice(0, 40) : '';

    let accountLine = 'Гость (не авторизован)';
    const userId = getUserFromToken(req.headers.authorization);
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true },
      });
      if (user) {
        accountLine = `@${user.username} <${user.email}> (id: ${user.id})`;
      }
    }

    const reasonLabel = PWA_UNINSTALL_REASON_LABELS[reason];
    void sendAdminNotification(
      'Отзыв: удалили PWA SoundLab',
      [
        `Причина: ${reasonLabel} (${reason})`,
        `Подробности: ${details || '—'}`,
        `Аккаунт: ${accountLine}`,
        `Платформа: ${platform || '—'}`,
        `Язык: ${language || '—'}`,
        `User-Agent: ${userAgent || '—'}`,
        `IP: ${req.ip || '—'}`,
        `Время: ${new Date().toISOString()}`,
      ].join('\n'),
    );

    res.json({ success: true });
  } catch (error) {
    console.error('pwa-uninstall feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Helper function to check if user is admin
const isAdmin = async (authHeader?: string) => {
  if (!authHeader) return false;
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });
    return user?.role === 'ADMIN';
  } catch {
    return false;
  }
};

// Extended Request interface
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    role: string;
    createdAt: Date;
  };
}

// Authentication middleware
const authenticateToken = async (req: AuthenticatedRequest, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        emailVerified: true,
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Email not verified',
        requiresVerification: true,
        email: user.email,
      });
    }

    const { emailVerified: _emailVerified, ...authenticatedUser } = user;
    req.user = authenticatedUser;
    next();
  } catch (error) {
    debugLog('Auth middleware: Invalid token -', error instanceof Error ? error.message : 'unknown error');
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const isMidiProjectData = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const asyncRoute = (
  handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>,
) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void handler(req, res).catch(next);
};

// MIDI projects are private to the authenticated account.
app.get('/api/midi-projects', authenticateToken, asyncRoute(async (req, res) => {
  const projects = await prisma.midiProject.findMany({
    where: { ownerId: req.user!.id },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(projects);
}));

app.get('/api/midi-projects/:id', authenticateToken, asyncRoute(async (req, res) => {
  const project = await prisma.midiProject.findFirst({
    where: { id: req.params.id, ownerId: req.user!.id },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
}));

app.post(
  '/api/midi-projects/:id/samples',
  authenticateToken,
  uploadRateLimit,
  receiveMidiSample,
  asyncRoute(async (req, res) => {
    const project = await prisma.midiProject.findFirst({
      where: { id: req.params.id, ownerId: req.user!.id },
      select: { id: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'Audio sample is required' });

    const requestedId = typeof req.body?.sampleId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.body.sampleId)
      ? req.body.sampleId
      : undefined;
    if (requestedId) {
      const existing = await prisma.midiSample.findUnique({
        where: { id: requestedId },
        select: { id: true, ownerId: true, projectId: true, name: true, mimeType: true, size: true, createdAt: true },
      });
      if (existing) {
        if (existing.ownerId !== req.user!.id || existing.projectId !== project.id) {
          return res.status(409).json({ error: 'Sample ID is already in use' });
        }
        const { ownerId: _ownerId, projectId: _projectId, ...metadata } = existing;
        return res.json(metadata);
      }
    }

    const sample = await prisma.midiSample.create({
      data: {
        ...(requestedId ? { id: requestedId } : {}),
        name: req.file.originalname.slice(0, 255),
        mimeType: req.file.mimetype || 'application/octet-stream',
        data: req.file.buffer,
        size: req.file.size,
        ownerId: req.user!.id,
        projectId: project.id,
      },
      select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
    });
    res.status(201).json(sample);
  }),
);

app.get('/api/midi-samples/:id', authenticateToken, asyncRoute(async (req, res) => {
  const sample = await prisma.midiSample.findFirst({
    where: { id: req.params.id, ownerId: req.user!.id },
    select: { data: true, mimeType: true, size: true },
  });
  if (!sample) return res.status(404).json({ error: 'Sample not found' });

  res.setHeader('Content-Type', sample.mimeType);
  res.setHeader('Content-Length', String(sample.size));
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(sample.data));
}));

app.post('/api/midi-projects', authenticateToken, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name || !isMidiProjectData(body.data)) {
    return res.status(400).json({ error: 'Project name and data are required' });
  }

  try {
    await assertCanCreateMidiProject(req.user!.id);
  } catch (e: any) {
    return res.status(e.status || 402).json({ error: e.message, code: e.code });
  }

  const project = await prisma.midiProject.create({
    data: {
      name,
      data: body.data,
      ownerId: req.user!.id,
    },
  });
  await recordMidiCloudSave(req.user!.id);
  res.status(201).json(project);
}));

app.put('/api/midi-projects/:id', authenticateToken, asyncRoute(async (req, res) => {
  const existing = await prisma.midiProject.findFirst({
    where: { id: req.params.id, ownerId: req.user!.id },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) {
    return res.status(400).json({ error: 'Project name is required' });
  }
  const hasData = isMidiProjectData(body.data);
  if (body.data !== undefined && !hasData) {
    return res.status(400).json({ error: 'Invalid project data' });
  }

  const project = await prisma.midiProject.update({
    where: { id: existing.id },
    data: {
      name,
      ...(hasData ? { data: body.data } : {}),
    },
  });
  res.json(project);
}));

app.delete('/api/midi-projects/:id', authenticateToken, asyncRoute(async (req, res) => {
  const result = await prisma.midiProject.deleteMany({
    where: { id: req.params.id, ownerId: req.user!.id },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Project not found' });
  res.status(204).send();
}));

// Admin middleware — always re-check role from DB (never trust JWT.role alone)
const requireAdmin = async (req: AuthenticatedRequest, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Email not verified' });
    }
    if (user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.use('/api/profile', createProfileRouter(authenticateToken, uploadsDir));
app.use('/api/follows', createFollowRouter(authenticateToken));
app.use('/api/chats', createChatRouter(authenticateToken, uploadsDir));
app.use('/api/blocks', createBlockRouter(authenticateToken));
app.use('/api/presets', createPresetRouter(prisma, authenticateToken, uploadsDir, privatePresetsDir));

app.get('/api/notifications/unread-count', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const unreadCount = await notificationService.unreadCount(req.user!.id);
    res.json({ unreadCount });
  } catch (error) {
    console.error('Failed to fetch notification unread count:', error);
    res.status(500).json({ error: 'Failed to fetch notification unread count' });
  }
});

app.get('/api/notifications', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    res.json(await notificationService.list(req.user!.id, limit));
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.patch('/api/notifications/read', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) && req.body.ids.every((id: unknown) => typeof id === 'string')
      ? req.body.ids as string[]
      : undefined;
    const unreadCount = await notificationService.markRead(req.user!.id, ids);
    res.json({ unreadCount });
  } catch (error) {
    console.error('Failed to mark notifications as read:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

app.delete('/api/notifications', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const deletedCount = await notificationService.clear(req.user!.id);
    res.json({ deletedCount, unreadCount: 0 });
  } catch (error) {
    console.error('Failed to clear notifications:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Create post with media
app.post('/api/posts', uploadRateLimit, upload.array('media', 10), async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const content = sanitizeUserText(req.body?.content, 4000);
    const files = (req.files as Express.Multer.File[]) || [];

    if (!content && files.length === 0) {
      return res.status(400).json({ error: 'Content or media required' });
    }

    const mediaItems = files.map((file) => {
      const ext = safeUploadExtension(file.filename) || safeUploadExtension(file.originalname) || '.jpg';
      return {
        type: mediaKindFromExt(ext),
        url: `/uploads/${path.basename(file.filename)}`,
      };
    });

    const post = await prisma.post.create({
      data: {
        content: content || '',
        authorId: userId,
        media: {
          create: mediaItems
        }
      },
      include: {
        media: true,
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          }
        }
      }
    });

    res.status(201).json(post);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get posts (paginated — all posts remain reachable via offset)
app.get('/api/posts', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const sort = req.query.sort === 'trending' ? 'trending' : 'latest';
    const rawTag = typeof req.query.tag === 'string' ? req.query.tag : '';
    const tag = rawTag.replace(/^#/, '').trim().slice(0, 64);
    const take = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const skip = Math.max(0, Number(req.query.offset) || 0);
    const where = tag
      ? {
          content: {
            contains: `#${tag}`,
            mode: 'insensitive' as const,
          },
        }
      : undefined;

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        select: {
          id: true,
          content: true,
          authorId: true,
          likes: true,
          commentsCount: true,
          views: true,
          createdAt: true,
          updatedAt: true,
          media: { select: { id: true, type: true, url: true, createdAt: true } },
          author: { select: authorPreviewSelect },
          likesList: userId
            ? {
                where: { userId },
                select: { id: true },
              }
            : false,
        },
        orderBy:
          sort === 'trending'
            ? [{ likes: 'desc' }, { commentsCount: 'desc' }, { createdAt: 'desc' }]
            : { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.post.count({ where }),
    ]);

    const items = posts.map((post) => ({
      ...post,
      isLiked: userId ? Boolean(post.likesList && post.likesList.length > 0) : false,
      likesList: undefined,
    }));

    res.json({
      items,
      total,
      limit: take,
      offset: skip,
      hasMore: skip + items.length < total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      include: {
        media: true,
        author: { select: authorPreviewSelect },
        likesList: userId ? { where: { userId }, select: { id: true } } : false,
      },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ ...post, isLiked: userId ? post.likesList.length > 0 : false, likesList: undefined });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const existing = await prisma.postLike.findUnique({ where: { userId_postId: { userId, postId: post.id } } });
    if (existing) return res.status(400).json({ error: 'Already liked' });
    await prisma.$transaction([
      prisma.postLike.create({ data: { userId, postId: post.id } }),
      prisma.post.update({ where: { id: post.id }, data: { likes: { increment: 1 } } }),
    ]);
    const updated = await prisma.post.findUnique({ where: { id: post.id }, select: { likes: true } });
    void notificationService.create({
      userId: post.authorId,
      actorId: userId,
      type: 'LIKE',
      entityType: 'post',
      entityId: post.id,
    }).catch((error) => console.error('Failed to create like notification:', error));
    res.json({ id: post.id, likes: updated?.likes ?? 0, isLiked: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

app.delete('/api/posts/:id/like', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const existing = await prisma.postLike.findUnique({ where: { userId_postId: { userId, postId: post.id } } });
    if (!existing) return res.status(400).json({ error: 'Post is not liked' });
    await prisma.$transaction([
      prisma.postLike.delete({ where: { id: existing.id } }),
      prisma.post.update({ where: { id: post.id }, data: { likes: { decrement: 1 } } }),
    ]);
    const updated = await prisma.post.findUnique({ where: { id: post.id }, select: { likes: true } });
    res.json({ id: post.id, likes: Math.max(0, updated?.likes ?? 0), isLiked: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to unlike post' });
  }
});

app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const comments = await prisma.postComment.findMany({
      where: { postId: req.params.id },
      include: {
        author: { select: authorPreviewSelect },
        votes: userId
          ? { where: { userId }, select: { type: true }, take: 1 }
          : false,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json(comments.map((c) => mapCommentWithVotes(c)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const validation = validateMessageContent(req.body?.text);
    if (!validation.valid || !validation.content) return res.status(400).json({ error: validation.error || 'Invalid comment' });
    if (validation.content.length > 1000) return res.status(400).json({ error: 'Comment is too long' });
    const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    let parentId: string | null = null;
    let replyToAuthorId: string | null = null;
    const rawParentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : '';
    if (rawParentId) {
      const parent = await prisma.postComment.findFirst({
        where: { id: rawParentId, postId: post.id },
        select: { id: true, parentId: true, authorId: true },
      });
      if (!parent) return res.status(400).json({ error: 'Parent comment not found' });
      // Flatten to one level under the root comment
      parentId = parent.parentId || parent.id;
      replyToAuthorId = parent.authorId;
    }

    const [comment, updated] = await prisma.$transaction([
      prisma.postComment.create({
        data: {
          text: validation.content,
          authorId: userId,
          postId: post.id,
          parentId,
        },
        include: { author: { select: authorPreviewSelect } },
      }),
      prisma.post.update({ where: { id: post.id }, data: { commentsCount: { increment: 1 } }, select: { commentsCount: true } }),
    ]);

    const notifyIds = new Set<string>();
    if (post.authorId !== userId) notifyIds.add(post.authorId);
    if (replyToAuthorId && replyToAuthorId !== userId) notifyIds.add(replyToAuthorId);
    for (const targetId of notifyIds) {
      void notificationService.create({
        userId: targetId,
        actorId: userId,
        type: 'COMMENT',
        entityType: 'post',
        entityId: post.id,
      }).catch((error) => console.error('Failed to create comment notification:', error));
    }

    res.status(201).json({
      comment: mapCommentWithVotes({ ...comment, likes: 0, dislikes: 0, votes: [] }),
      commentsCount: updated.commentsCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

app.post('/api/posts/:postId/comments/:commentId/like', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const comment = await prisma.postComment.findFirst({
      where: { id: req.params.commentId, postId: req.params.postId },
      select: { id: true, text: true },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const result = await setPostCommentVote(userId, comment.id, 'LIKE');
    if (!result) return res.status(404).json({ error: 'Comment not found' });
    res.json({
      id: comment.id,
      ...result,
      text: result.isHidden ? HIDDEN_COMMENT_TEXT : comment.text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to like comment' });
  }
});

app.post('/api/posts/:postId/comments/:commentId/dislike', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const comment = await prisma.postComment.findFirst({
      where: { id: req.params.commentId, postId: req.params.postId },
      select: { id: true, text: true },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const result = await setPostCommentVote(userId, comment.id, 'DISLIKE');
    if (!result) return res.status(404).json({ error: 'Comment not found' });
    res.json({
      id: comment.id,
      ...result,
      text: result.isHidden ? HIDDEN_COMMENT_TEXT : comment.text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to dislike comment' });
  }
});

app.delete('/api/posts/:id', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== userId) return res.status(403).json({ error: 'Access denied' });
    await prisma.post.delete({ where: { id: post.id } });
    res.json({ success: true, id: post.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

app.delete('/api/posts/:postId/comments/:commentId', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const comment = await prisma.postComment.findFirst({
      where: { id: req.params.commentId, postId: req.params.postId },
      select: { id: true, authorId: true, postId: true },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.authorId !== userId) return res.status(403).json({ error: 'Access denied' });

    const deleteCount = 1 + await prisma.postComment.count({ where: { parentId: comment.id } });
    await prisma.postComment.delete({ where: { id: comment.id } });
    const updated = await prisma.post.update({
      where: { id: comment.postId },
      data: { commentsCount: { decrement: deleteCount } },
      select: { commentsCount: true },
    });

    res.json({
      success: true,
      id: comment.id,
      commentsCount: Math.max(0, updated.commentsCount),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.post('/api/posts/:id/view', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true, views: true },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId === userId) return res.json({ id: post.id, views: post.views });
    const existing = await prisma.postView.findUnique({
      where: { userId_postId: { userId, postId: post.id } },
      select: { id: true },
    });
    if (existing) return res.json({ id: post.id, views: post.views });
    try {
      const [, updated] = await prisma.$transaction([
        prisma.postView.create({ data: { userId, postId: post.id } }),
        prisma.post.update({ where: { id: post.id }, data: { views: { increment: 1 } }, select: { views: true } }),
      ]);
      return res.json({ id: post.id, views: updated.views });
    } catch {
      const current = await prisma.post.findUnique({ where: { id: post.id }, select: { views: true } });
      return res.json({ id: post.id, views: current?.views ?? post.views });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to record post view' });
  }
});

const soundPreviewSelect = {
  id: true,
  title: true,
  audioUrl: true,
  duration: true,
  useCount: true,
  authorId: true,
  originalSoundTokId: true,
  createdAt: true,
  author: { select: { id: true, username: true, displayName: true, avatar: true } },
} as const;

async function ensureSoundForSoundTok(soundTokId: string) {
  const tok = await prisma.soundTok.findUnique({
    where: { id: soundTokId },
    include: {
      author: { select: { id: true, username: true } },
      sound: { select: soundPreviewSelect },
    },
  });
  if (!tok) return null;
  if (tok.sound) return tok.sound;

  const existingOriginal = await prisma.sound.findUnique({
    where: { originalSoundTokId: tok.id },
    select: soundPreviewSelect,
  });
  if (existingOriginal) {
    if (!tok.soundId) {
      await prisma.soundTok.update({
        where: { id: tok.id },
        data: { soundId: existingOriginal.id },
      });
    }
    return existingOriginal;
  }

  const title = `Оригинальный звук — ${tok.author.username}`;
  const sound = await prisma.sound.create({
    data: {
      title,
      audioUrl: tok.videoUrl,
      authorId: tok.authorId,
      originalSoundTokId: tok.id,
      useCount: 1,
    },
    select: soundPreviewSelect,
  });
  await prisma.soundTok.update({
    where: { id: tok.id },
    data: { soundId: sound.id },
  });
  return sound;
}

// Create SoundTok (short video)
app.post('/api/soundtok', uploadRateLimit, (req, res, next) => {
  upload.single('video')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Видео слишком большое — максимум 15 МБ' });
    }
    console.warn('SoundTok multer error:', error);
    const raw = error instanceof Error ? error.message : '';
    if (/invalid file type/i.test(raw)) {
      return res.status(400).json({
        error: 'Неподходящий тип файла. Загрузите видео (например MP4 или WebM)',
      });
    }
    return res.status(400).json({
      error: 'Не удалось принять видео. Проверьте формат и размер файла',
    });
  });
}, async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    debugLog('SoundTok upload', { userId: userId || null, hasFile: Boolean(req.file) });
    
    if (!userId) {
      return res.status(401).json({ error: 'Войдите в аккаунт, чтобы продолжить' });
    }

    const description = sanitizeUserText(req.body?.description, 500);
    const file = req.file as Express.Multer.File;
    const reuseSoundId =
      typeof req.body?.soundId === 'string' && req.body.soundId.trim()
        ? req.body.soundId.trim()
        : null;

    if (!file) {
      return res.status(400).json({ error: 'Выберите видеофайл для загрузки' });
    }

    const videoUrl = `/uploads/${path.basename(file.filename)}`;

    let soundId: string | null = null;
    if (reuseSoundId) {
      const existing = await prisma.sound.findUnique({ where: { id: reuseSoundId } });
      if (!existing) {
        return res.status(404).json({ error: 'Звук не найден. Выберите другой' });
      }
      soundId = existing.id;
    }

    const author = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    const soundTok = await prisma.$transaction(async (tx) => {
      const created = await tx.soundTok.create({
        data: {
          description,
          videoUrl,
          authorId: userId,
          soundId: soundId ?? undefined,
        },
        include: {
          author: { select: authorPreviewSelect },
          sound: { select: soundPreviewSelect },
        },
      });

      if (soundId) {
        await tx.sound.update({
          where: { id: soundId },
          data: { useCount: { increment: 1 } },
        });
        return created;
      }

      const sound = await tx.sound.create({
        data: {
          title: `Оригинальный звук — ${author?.username || 'user'}`,
          audioUrl: videoUrl,
          authorId: userId,
          originalSoundTokId: created.id,
          useCount: 1,
        },
        select: soundPreviewSelect,
      });
      return tx.soundTok.update({
        where: { id: created.id },
        data: { soundId: sound.id },
        include: {
          author: { select: authorPreviewSelect },
          sound: { select: soundPreviewSelect },
        },
      });
    });

    res.status(201).json(soundTok);
  } catch (error) {
    console.error('SoundTok upload error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Не удалось опубликовать видео. Попробуйте ещё раз' });
  }
});

async function getSoundTokRepostPreviews(soundTokIds: string[], take = 3) {
  const previewByTok = new Map<string, Array<{
    id: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    role: string;
    plan: string;
    planExpiresAt: Date | null;
  }>>();
  if (soundTokIds.length === 0) return previewByTok;

  const rows = await prisma.soundTokRepost.findMany({
    where: { soundTokId: { in: soundTokIds } },
    orderBy: { createdAt: 'asc' },
    select: {
      soundTokId: true,
      user: { select: authorPreviewSelect },
    },
  });

  for (const row of rows) {
    const list = previewByTok.get(row.soundTokId) ?? [];
    if (list.length >= take) continue;
    list.push(row.user);
    previewByTok.set(row.soundTokId, list);
  }
  return previewByTok;
}

async function getSoundTokRepostPreview(soundTokId: string, take = 3) {
  const map = await getSoundTokRepostPreviews([soundTokId], take);
  return map.get(soundTokId) ?? [];
}

// Get SoundToks (paginated — full catalog remains reachable via offset)
app.get('/api/soundtok', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const take = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = Math.max(0, Number(req.query.offset) || 0);

    let followingIds = new Set<string>();
    if (userId) {
      const follows = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      followingIds = new Set(follows.map((f) => f.followingId));
    }

    const [soundToks, total] = await Promise.all([
      prisma.soundTok.findMany({
        select: {
          id: true,
          description: true,
          videoUrl: true,
          authorId: true,
          soundId: true,
          likes: true,
          commentsCount: true,
          views: true,
          repostsCount: true,
          sharesCount: true,
          createdAt: true,
          updatedAt: true,
          author: { select: authorPreviewSelect },
          sound: { select: soundPreviewSelect },
          likesList: userId
            ? {
                where: { userId },
                select: { id: true },
              }
            : false,
          reposts: userId
            ? {
                where: { userId },
                select: { id: true },
              }
            : false,
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.soundTok.count(),
    ]);

    const previewByTok = await getSoundTokRepostPreviews(soundToks.map((tok) => tok.id));

    const items = soundToks.map((soundTok) => ({
      ...soundTok,
      isLiked: userId ? Boolean(soundTok.likesList && soundTok.likesList.length > 0) : false,
      isReposted: userId ? Boolean(soundTok.reposts && soundTok.reposts.length > 0) : false,
      authorIsFollowed: userId ? followingIds.has(soundTok.authorId) : false,
      repostPreview: previewByTok.get(soundTok.id) ?? [],
      likesList: undefined,
      reposts: undefined,
    }));

    res.json({
      items,
      total,
      limit: take,
      offset: skip,
      hasMore: skip + items.length < total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch SoundToks' });
  }
});

// Single SoundTok (for notification / share deep-links)
app.get('/api/soundtok/:id', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        description: true,
        videoUrl: true,
        authorId: true,
        soundId: true,
        likes: true,
        commentsCount: true,
        views: true,
        repostsCount: true,
        sharesCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: authorPreviewSelect },
        sound: { select: soundPreviewSelect },
        likesList: userId
          ? {
              where: { userId },
              select: { id: true },
            }
          : false,
        reposts: userId
          ? {
              where: { userId },
              select: { id: true },
            }
          : false,
      },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });

    let authorIsFollowed = false;
    if (userId) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: soundTok.authorId,
          },
        },
        select: { id: true },
      });
      authorIsFollowed = Boolean(follow);
    }

    const repostPreview = await getSoundTokRepostPreview(soundTok.id);

    res.json({
      ...soundTok,
      isLiked: userId ? Boolean(soundTok.likesList && soundTok.likesList.length > 0) : false,
      isReposted: userId ? Boolean(soundTok.reposts && soundTok.reposts.length > 0) : false,
      authorIsFollowed,
      repostPreview,
      likesList: undefined,
      reposts: undefined,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch SoundTok' });
  }
});

// ─── Sounds (SoundTok audio pages) ───────────────────────────────────────────

app.get('/api/sounds/from-video/:soundTokId', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const sound = await ensureSoundForSoundTok(req.params.soundTokId);
    if (!sound) return res.status(404).json({ error: 'SoundTok not found' });

    let isFavorited = false;
    if (userId) {
      const fav = await prisma.soundFavorite.findUnique({
        where: { userId_soundId: { userId, soundId: sound.id } },
        select: { id: true },
      });
      isFavorited = Boolean(fav);
    }
    res.json({ ...sound, isFavorited });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to resolve sound' });
  }
});

app.get('/api/sounds/favorites', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const take = Math.min(50, Math.max(1, Number(req.query.limit) || 24));
    const skip = Math.max(0, Number(req.query.offset) || 0);

    const [rows, total] = await Promise.all([
      prisma.soundFavorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          sound: { select: soundPreviewSelect },
        },
      }),
      prisma.soundFavorite.count({ where: { userId } }),
    ]);

    const items = rows.map((row) => ({
      ...row.sound,
      isFavorited: true,
      favoritedAt: row.createdAt,
    }));

    res.json({
      items,
      total,
      limit: take,
      offset: skip,
      hasMore: skip + items.length < total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch favorite sounds' });
  }
});

app.get('/api/sounds/:id', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const sound = await prisma.sound.findUnique({
      where: { id: req.params.id },
      select: soundPreviewSelect,
    });
    if (!sound) return res.status(404).json({ error: 'Sound not found' });

    let isFavorited = false;
    if (userId) {
      const fav = await prisma.soundFavorite.findUnique({
        where: { userId_soundId: { userId, soundId: sound.id } },
        select: { id: true },
      });
      isFavorited = Boolean(fav);
    }

    res.json({ ...sound, isFavorited });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch sound' });
  }
});

app.get('/api/sounds/:id/videos', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const soundId = req.params.id;
    const take = Math.min(50, Math.max(1, Number(req.query.limit) || 24));
    const skip = Math.max(0, Number(req.query.offset) || 0);

    const sound = await prisma.sound.findUnique({ where: { id: soundId }, select: { id: true } });
    if (!sound) return res.status(404).json({ error: 'Sound not found' });

    let followingIds = new Set<string>();
    if (userId) {
      const follows = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      followingIds = new Set(follows.map((f) => f.followingId));
    }

    const [soundToks, total] = await Promise.all([
      prisma.soundTok.findMany({
        where: { soundId },
        select: {
          id: true,
          description: true,
          videoUrl: true,
          authorId: true,
          soundId: true,
          likes: true,
          commentsCount: true,
          createdAt: true,
          updatedAt: true,
          author: { select: authorPreviewSelect },
          sound: { select: soundPreviewSelect },
          likesList: userId
            ? { where: { userId }, select: { id: true } }
            : false,
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.soundTok.count({ where: { soundId } }),
    ]);

    const items = soundToks.map((soundTok) => ({
      ...soundTok,
      isLiked: userId ? Boolean(soundTok.likesList && soundTok.likesList.length > 0) : false,
      authorIsFollowed: userId ? followingIds.has(soundTok.authorId) : false,
      likesList: undefined,
    }));

    res.json({
      items,
      total,
      limit: take,
      offset: skip,
      hasMore: skip + items.length < total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch videos for sound' });
  }
});

app.post('/api/sounds/:id/favorite', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const sound = await prisma.sound.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!sound) return res.status(404).json({ error: 'Sound not found' });

    await prisma.soundFavorite.upsert({
      where: { userId_soundId: { userId, soundId: sound.id } },
      create: { userId, soundId: sound.id },
      update: {},
    });

    res.json({ soundId: sound.id, isFavorited: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to favorite sound' });
  }
});

app.delete('/api/sounds/:id/favorite', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await prisma.soundFavorite.deleteMany({
      where: { userId, soundId: req.params.id },
    });

    res.json({ soundId: req.params.id, isFavorited: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to unfavorite sound' });
  }
});

// Like SoundTok
app.post('/api/soundtok/:id/like', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user already liked this SoundTok
    const existingLike = await prisma.like.findUnique({
      where: {
        userId_soundTokId: {
          userId: userId,
          soundTokId: req.params.id
        }
      }
    });

    if (existingLike) {
      return res.status(400).json({ error: 'Already liked' });
    }

    // Create the like and update the count
    await prisma.like.create({
      data: {
        userId: userId,
        soundTokId: req.params.id
      }
    });

    const soundTok = await prisma.soundTok.update({
      where: { id: req.params.id },
      data: {
        likes: {
          increment: 1
        }
      }
    });

    void notificationService.create({
      userId: soundTok.authorId,
      actorId: userId,
      type: 'LIKE',
      entityType: 'soundtok',
      entityId: soundTok.id,
    }).catch((error) => console.error('Failed to create SoundTok like notification:', error));
    res.json(soundTok);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to like SoundTok' });
  }
});

// Unlike SoundTok
app.delete('/api/soundtok/:id/like', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const existingLike = await prisma.like.findUnique({
      where: {
        userId_soundTokId: {
          userId,
          soundTokId: req.params.id
        }
      }
    });

    if (!existingLike) {
      const current = await prisma.soundTok.findUnique({
        where: { id: req.params.id }
      });
      return res.json({ ...current, isLiked: false });
    }

    const [, soundTok] = await prisma.$transaction([
      prisma.like.delete({
        where: {
          userId_soundTokId: {
            userId,
            soundTokId: req.params.id
          }
        }
      }),
      prisma.soundTok.update({
        where: { id: req.params.id },
        data: {
          likes: {
            decrement: 1
          }
        }
      })
    ]);

    res.json({ ...soundTok, likes: Math.max(0, soundTok.likes), isLiked: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to unlike SoundTok' });
  }
});

// Repost SoundTok
app.post('/api/soundtok/:id/repost', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true, repostsCount: true },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });

    const existing = await prisma.soundTokRepost.findUnique({
      where: { userId_soundTokId: { userId, soundTokId: soundTok.id } },
      select: { id: true },
    });
    if (existing) {
      const repostPreview = await getSoundTokRepostPreview(soundTok.id);
      return res.json({
        id: soundTok.id,
        repostsCount: soundTok.repostsCount,
        isReposted: true,
        repostPreview,
      });
    }

    const [, updated] = await prisma.$transaction([
      prisma.soundTokRepost.create({ data: { userId, soundTokId: soundTok.id } }),
      prisma.soundTok.update({
        where: { id: soundTok.id },
        data: { repostsCount: { increment: 1 } },
        select: { id: true, repostsCount: true },
      }),
    ]);

    const repostPreview = await getSoundTokRepostPreview(soundTok.id);
    res.json({ ...updated, isReposted: true, repostPreview });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to repost SoundTok' });
  }
});

app.delete('/api/soundtok/:id/repost', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const existing = await prisma.soundTokRepost.findUnique({
      where: { userId_soundTokId: { userId, soundTokId: req.params.id } },
      select: { id: true },
    });
    if (!existing) {
      const current = await prisma.soundTok.findUnique({
        where: { id: req.params.id },
        select: { id: true, repostsCount: true },
      });
      const repostPreview = current ? await getSoundTokRepostPreview(current.id) : [];
      return res.json({ ...current, isReposted: false, repostPreview });
    }

    const [, updated] = await prisma.$transaction([
      prisma.soundTokRepost.delete({
        where: { userId_soundTokId: { userId, soundTokId: req.params.id } },
      }),
      prisma.soundTok.update({
        where: { id: req.params.id },
        data: { repostsCount: { decrement: 1 } },
        select: { id: true, repostsCount: true },
      }),
    ]);

    const repostPreview = await getSoundTokRepostPreview(req.params.id);
    res.json({
      id: updated.id,
      repostsCount: Math.max(0, updated.repostsCount),
      isReposted: false,
      repostPreview,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to remove repost' });
  }
});

// List who reposted a SoundTok
app.get('/api/soundtok/:id/reposts', async (req, res) => {
  try {
    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: { id: true, repostsCount: true },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });

    const take = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const skip = Math.max(0, Number(req.query.offset) || 0);

    const [rows, total] = await Promise.all([
      prisma.soundTokRepost.findMany({
        where: { soundTokId: soundTok.id },
        orderBy: { createdAt: 'asc' },
        take,
        skip,
        select: {
          id: true,
          createdAt: true,
          user: { select: authorPreviewSelect },
        },
      }),
      prisma.soundTokRepost.count({ where: { soundTokId: soundTok.id } }),
    ]);

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        user: row.user,
      })),
      total: Math.max(total, soundTok.repostsCount),
      limit: take,
      offset: skip,
      hasMore: skip + rows.length < total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch reposts' });
  }
});

// Record SoundTok share (copy link / send to chat)
app.post('/api/soundtok/:id/share', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: { id: true, sharesCount: true },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });

    const updated = await prisma.soundTok.update({
      where: { id: soundTok.id },
      data: { sharesCount: { increment: 1 } },
      select: { id: true, sharesCount: true },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to record share' });
  }
});

// Record SoundTok view (auth or guest key)
app.post('/api/soundtok/:id/view', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const guestKeyRaw = typeof req.body?.guestKey === 'string' ? req.body.guestKey.trim() : '';
    const guestKey =
      guestKeyRaw && guestKeyRaw.length >= 8 && guestKeyRaw.length <= 128 ? guestKeyRaw : null;

    if (!userId && !guestKey) {
      return res.status(400).json({ error: 'guestKey required for anonymous views' });
    }

    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true, views: true },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });

    if (userId && soundTok.authorId === userId) {
      return res.json({ id: soundTok.id, views: soundTok.views });
    }

    if (userId) {
      const existing = await prisma.soundTokView.findUnique({
        where: { userId_soundTokId: { userId, soundTokId: soundTok.id } },
        select: { id: true },
      });
      if (existing) return res.json({ id: soundTok.id, views: soundTok.views });
      try {
        const [, updated] = await prisma.$transaction([
          prisma.soundTokView.create({ data: { userId, soundTokId: soundTok.id } }),
          prisma.soundTok.update({
            where: { id: soundTok.id },
            data: { views: { increment: 1 } },
            select: { views: true },
          }),
        ]);
        return res.json({ id: soundTok.id, views: updated.views });
      } catch {
        const current = await prisma.soundTok.findUnique({
          where: { id: soundTok.id },
          select: { views: true },
        });
        return res.json({ id: soundTok.id, views: current?.views ?? soundTok.views });
      }
    }

    const existingGuest = await prisma.soundTokView.findUnique({
      where: { guestKey_soundTokId: { guestKey: guestKey!, soundTokId: soundTok.id } },
      select: { id: true },
    });
    if (existingGuest) return res.json({ id: soundTok.id, views: soundTok.views });

    try {
      const [, updated] = await prisma.$transaction([
        prisma.soundTokView.create({ data: { guestKey: guestKey!, soundTokId: soundTok.id } }),
        prisma.soundTok.update({
          where: { id: soundTok.id },
          data: { views: { increment: 1 } },
          select: { views: true },
        }),
      ]);
      return res.json({ id: soundTok.id, views: updated.views });
    } catch {
      const current = await prisma.soundTok.findUnique({
        where: { id: soundTok.id },
        select: { views: true },
      });
      return res.json({ id: soundTok.id, views: current?.views ?? soundTok.views });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to record SoundTok view' });
  }
});

app.delete('/api/soundtok/:id', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true, videoUrl: true },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });
    if (soundTok.authorId !== userId) return res.status(403).json({ error: 'Access denied' });

    await prisma.soundTok.delete({ where: { id: soundTok.id } });

    if (soundTok.videoUrl?.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, path.basename(soundTok.videoUrl));
      void fs.promises.unlink(filePath).catch(() => undefined);
    }

    res.json({ success: true, id: soundTok.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete SoundTok' });
  }
});

// Get comments for SoundTok
app.get('/api/soundtok/:id/comments', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    const comments = await prisma.comment.findMany({
      where: {
        soundTokId: req.params.id
      },
      include: {
        author: { select: authorPreviewSelect },
        votes: userId
          ? { where: { userId }, select: { type: true }, take: 1 }
          : false,
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50,
    });

    res.json(comments.map((c) => mapCommentWithVotes(c)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Create comment for SoundTok
app.post('/api/soundtok/:id/comments', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validation = validateMessageContent(req.body?.text);
    if (!validation.valid || !validation.content) {
      return res.status(400).json({ error: validation.error || 'Comment text required' });
    }
    if (validation.content.length > 1000) {
      return res.status(400).json({ error: 'Comment is too long' });
    }

    const soundTok = await prisma.soundTok.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true },
    });
    if (!soundTok) return res.status(404).json({ error: 'SoundTok not found' });

    let parentId: string | null = null;
    let replyToAuthorId: string | null = null;
    const rawParentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : '';
    if (rawParentId) {
      const parent = await prisma.comment.findFirst({
        where: { id: rawParentId, soundTokId: soundTok.id },
        select: { id: true, parentId: true, authorId: true },
      });
      if (!parent) return res.status(400).json({ error: 'Parent comment not found' });
      parentId = parent.parentId || parent.id;
      replyToAuthorId = parent.authorId;
    }

    const comment = await prisma.comment.create({
      data: {
        text: validation.content,
        authorId: userId,
        soundTokId: soundTok.id,
        parentId,
      },
      include: {
        author: { select: authorPreviewSelect },
      }
    });

    const updated = await prisma.soundTok.update({
      where: { id: soundTok.id },
      data: {
        commentsCount: {
          increment: 1
        }
      },
      select: { id: true, authorId: true, commentsCount: true }
    });

    const notifyIds = new Set<string>();
    if (updated.authorId !== userId) notifyIds.add(updated.authorId);
    if (replyToAuthorId && replyToAuthorId !== userId) notifyIds.add(replyToAuthorId);
    for (const targetId of notifyIds) {
      void notificationService.create({
        userId: targetId,
        actorId: userId,
        type: 'COMMENT',
        entityType: 'soundtok',
        entityId: updated.id,
      }).catch((error) => console.error('Failed to create SoundTok comment notification:', error));
    }

    res.status(201).json({
      comment: mapCommentWithVotes({ ...comment, likes: 0, dislikes: 0, votes: [] }),
      commentsCount: updated.commentsCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

app.delete('/api/soundtok/:soundTokId/comments/:commentId', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const comment = await prisma.comment.findFirst({
      where: { id: req.params.commentId, soundTokId: req.params.soundTokId },
      select: { id: true, authorId: true, soundTokId: true },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.authorId !== userId) return res.status(403).json({ error: 'Access denied' });

    const deleteCount = 1 + await prisma.comment.count({ where: { parentId: comment.id } });
    await prisma.comment.delete({ where: { id: comment.id } });
    const updated = await prisma.soundTok.update({
      where: { id: comment.soundTokId },
      data: { commentsCount: { decrement: deleteCount } },
      select: { commentsCount: true },
    });

    res.json({
      success: true,
      id: comment.id,
      commentsCount: Math.max(0, updated.commentsCount),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.post('/api/soundtok/:soundTokId/comments/:commentId/like', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const comment = await prisma.comment.findFirst({
      where: { id: req.params.commentId, soundTokId: req.params.soundTokId },
      select: { id: true, text: true },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const result = await setSoundTokCommentVote(userId, comment.id, 'LIKE');
    if (!result) return res.status(404).json({ error: 'Comment not found' });
    res.json({
      id: comment.id,
      ...result,
      text: result.isHidden ? HIDDEN_COMMENT_TEXT : comment.text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to like comment' });
  }
});

app.post('/api/soundtok/:soundTokId/comments/:commentId/dislike', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const comment = await prisma.comment.findFirst({
      where: { id: req.params.commentId, soundTokId: req.params.soundTokId },
      select: { id: true, text: true },
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const result = await setSoundTokCommentVote(userId, comment.id, 'DISLIKE');
    if (!result) return res.status(404).json({ error: 'Comment not found' });
    res.json({
      id: comment.id,
      ...result,
      text: result.isHidden ? HIDDEN_COMMENT_TEXT : comment.text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to dislike comment' });
  }
});

// Search functionality
app.get('/api/search', searchRateLimit, async (req, res) => {
  try {
    const { q, type } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
    }
    const query = q.trim().slice(0, 80);
    if (query.length < 2) {
      return res.status(400).json({ error: 'Search query too short' });
    }

    const results: {
      users: any[];
      posts: any[];
      soundToks: any[];
    } = {
      users: [],
      posts: [],
      soundToks: []
    };

    // Search users
    if (!type || type === 'users') {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { displayName: { contains: query, mode: 'insensitive' } },
            { usernameHistory: { some: { username: { contains: query, mode: 'insensitive' } } } },
          ]
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          bio: true,
          createdAt: true
        },
        take: 10
      });
      results.users = users;
    }

    // Search posts
    if (!type || type === 'posts') {
      const posts = await prisma.post.findMany({
        where: {
          content: { contains: query, mode: 'insensitive' }
        },
        include: {
          media: true,
          author: {
            select: {
              id: true,
              username: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10
      });
      results.posts = posts;
    }

    // Search SoundToks
    if (!type || type === 'soundtoks') {
      const soundToks = await prisma.soundTok.findMany({
        where: {
          description: { contains: query, mode: 'insensitive' }
        },
        include: {
          author: {
            select: {
              id: true,
              username: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10
      });
      results.soundToks = soundToks;
    }

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Admin endpoints
const parseAdminPage = (req: { query: Record<string, unknown> }) => {
  const take = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const skip = Math.max(0, Number(req.query.offset) || 0);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  return { take, skip, q };
};

const ADMIN_STATS_CACHE_TTL_MS = 30_000;
let adminStatsCache: { expiresAt: number; value: unknown } | null = null;

app.get('/api/admin/stats', requireAdmin, asyncRoute(async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  if (!forceRefresh && adminStatsCache && adminStatsCache.expiresAt > Date.now()) {
    res.setHeader('X-Admin-Stats-Cache', 'HIT');
    return res.json(adminStatsCache.value);
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const since7d = new Date(now.getTime() - 7 * dayMs);
  const since30d = new Date(now.getTime() - 30 * dayMs);
  const since14d = new Date(now.getTime() - 14 * dayMs);
  const abandonedBefore = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    usersCount,
    postsCount,
    soundToksCount,
    presetsPublished,
    activePro,
    activePlatinum,
    paymentsByKind,
    subscriptionAgg,
    tokenAgg,
    presetPurchasesCount,
    presetRevenue,
    pendingPayments,
    recentPayments,
    recentPresetPurchases,
    openReportsCount,
    startedAll,
    succeededAll,
    canceledAll,
    uniquePayers,
    abandonedPending,
    paymentsSince14d,
    paymentsByKindAll,
    started7d,
    succeeded7d,
    canceled7d,
    revenue7d,
    started30d,
    succeeded30d,
    canceled30d,
    revenue30d,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.post.count(),
    prisma.soundTok.count(),
    prisma.preset.count({ where: { status: 'PUBLISHED' } }),
    prisma.user.count({
      where: { plan: 'PRO', OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: now } }] },
    }),
    prisma.user.count({
      where: { plan: 'PLATINUM', OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: now } }] },
    }),
    prisma.payment.groupBy({
      by: ['kind'],
      where: { status: 'SUCCEEDED' },
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED', kind: { in: ['PLAN_PRO', 'PLAN_PLATINUM'] } },
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
    prisma.payment.aggregate({
      where: {
        status: 'SUCCEEDED',
        kind: { in: ['TOKENS_400', 'TOKENS_800', 'TOKENS_1200', 'TOKENS_2400'] },
      },
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
    prisma.presetPurchase.count({ where: { status: 'PAID' } }),
    prisma.presetPurchase.aggregate({
      where: { status: 'PAID' },
      _sum: { amountCents: true },
    }),
    prisma.payment.count({ where: { status: { in: ['PENDING', 'WAITING_FOR_CAPTURE'] } } }),
    prisma.payment.findMany({
      where: { status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        kind: true,
        amountRub: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    }),
    prisma.presetPurchase.findMany({
      where: { status: 'PAID' },
      orderBy: { purchasedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        purchasedAt: true,
        buyer: { select: { id: true, username: true } },
        preset: { select: { id: true, title: true } },
      },
    }),
    prisma.userReport.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } }),
    prisma.payment.count(),
    prisma.payment.count({ where: { status: 'SUCCEEDED' } }),
    prisma.payment.count({ where: { status: 'CANCELED' } }),
    prisma.payment.findMany({
      where: { status: 'SUCCEEDED' },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.payment.count({
      where: {
        status: { in: ['PENDING', 'WAITING_FOR_CAPTURE'] },
        createdAt: { lt: abandonedBefore },
      },
    }),
    prisma.payment.findMany({
      where: { createdAt: { gte: since14d } },
      select: { kind: true, status: true, amountRub: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payment.groupBy({
      by: ['kind', 'status'],
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
    prisma.payment.count({ where: { createdAt: { gte: since7d } } }),
    prisma.payment.count({ where: { status: 'SUCCEEDED', createdAt: { gte: since7d } } }),
    prisma.payment.count({ where: { status: 'CANCELED', createdAt: { gte: since7d } } }),
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED', createdAt: { gte: since7d } },
      _sum: { amountRub: true },
    }),
    prisma.payment.count({ where: { createdAt: { gte: since30d } } }),
    prisma.payment.count({ where: { status: 'SUCCEEDED', createdAt: { gte: since30d } } }),
    prisma.payment.count({ where: { status: 'CANCELED', createdAt: { gte: since30d } } }),
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED', createdAt: { gte: since30d } },
      _sum: { amountRub: true },
    }),
  ]);

  const subscriptionsCount = subscriptionAgg._count._all;
  const subscriptionsRevenueRub = subscriptionAgg._sum.amountRub || 0;
  const tokensCount = tokenAgg._count._all;
  const tokensRevenueRub = tokenAgg._sum.amountRub || 0;
  const paymentsRevenueRub = subscriptionsRevenueRub + tokensRevenueRub;

  const byKind = Object.fromEntries(
    paymentsByKind.map((row) => [
      row.kind,
      { count: row._count._all, revenueRub: row._sum.amountRub || 0 },
    ]),
  );

  const pct = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

  const funnelByKind: Record<
    string,
    { started: number; paid: number; canceled: number; pending: number; revenueRub: number; conversionPct: number }
  > = {};
  for (const row of paymentsByKindAll) {
    const slot = (funnelByKind[row.kind] ||= {
      started: 0,
      paid: 0,
      canceled: 0,
      pending: 0,
      revenueRub: 0,
      conversionPct: 0,
    });
    slot.started += row._count._all;
    if (row.status === 'SUCCEEDED') {
      slot.paid += row._count._all;
      slot.revenueRub += row._sum.amountRub || 0;
    } else if (row.status === 'CANCELED') {
      slot.canceled += row._count._all;
    } else {
      slot.pending += row._count._all;
    }
  }
  for (const slot of Object.values(funnelByKind)) {
    slot.conversionPct = pct(slot.paid, slot.started);
  }

  const dailyMap = new Map<string, { date: string; clicked: number; paid: number; canceled: number; revenueRub: number }>();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * dayMs);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, { date: key, clicked: 0, paid: 0, canceled: 0, revenueRub: 0 });
  }
  for (const p of paymentsSince14d) {
    const key = p.createdAt.toISOString().slice(0, 10);
    const slot = dailyMap.get(key);
    if (!slot) continue;
    slot.clicked += 1;
    if (p.status === 'SUCCEEDED') {
      slot.paid += 1;
      slot.revenueRub += p.amountRub;
    } else if (p.status === 'CANCELED') {
      slot.canceled += 1;
    }
  }

  const response = {
    totals: {
      users: usersCount,
      posts: postsCount,
      soundToks: soundToksCount,
      presetsPublished,
      pendingPayments,
      openReports: openReportsCount,
    },
    plans: {
      activePro,
      activePlatinum,
      activePaid: activePro + activePlatinum,
    },
    purchases: {
      subscriptions: { count: subscriptionsCount, revenueRub: subscriptionsRevenueRub },
      tokens: { count: tokensCount, revenueRub: tokensRevenueRub },
      presets: {
        count: presetPurchasesCount,
        revenueRub: Math.round((presetRevenue._sum.amountCents || 0) / 100),
        revenueCents: presetRevenue._sum.amountCents || 0,
      },
      paymentsRevenueRub,
      totalRevenueRub:
        paymentsRevenueRub + Math.round((presetRevenue._sum.amountCents || 0) / 100),
    },
    byKind,
    funnel: {
      clicked: startedAll,
      pending: pendingPayments,
      paid: succeededAll,
      canceled: canceledAll,
      abandonedPending,
      conversionPct: pct(succeededAll, startedAll),
      cancelPct: pct(canceledAll, startedAll),
      uniquePayers: uniquePayers.length,
      avgTicketRub:
        succeededAll > 0 ? Math.round(paymentsRevenueRub / succeededAll) : 0,
      last7d: {
        clicked: started7d,
        paid: succeeded7d,
        canceled: canceled7d,
        revenueRub: revenue7d._sum.amountRub || 0,
        conversionPct: pct(succeeded7d, started7d),
      },
      last30d: {
        clicked: started30d,
        paid: succeeded30d,
        canceled: canceled30d,
        revenueRub: revenue30d._sum.amountRub || 0,
        conversionPct: pct(succeeded30d, started30d),
      },
      byKind: funnelByKind,
      daily: Array.from(dailyMap.values()),
    },
    recent: {
      payments: recentPayments,
      presetPurchases: recentPresetPurchases,
    },
  };
  adminStatsCache = {
    expiresAt: Date.now() + ADMIN_STATS_CACHE_TTL_MS,
    value: response,
  };
  res.setHeader('X-Admin-Stats-Cache', 'MISS');
  res.json(response);
}));

app.get('/api/admin/payments', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip } = parseAdminPage(req);
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'SUCCEEDED';
  const where: Record<string, unknown> = {};
  if (status === 'PENDING') {
    where.status = { in: ['PENDING', 'WAITING_FOR_CAPTURE'] };
  } else if (status && status !== 'ALL') {
    where.status = status;
  }
  if (kind === 'subscriptions') where.kind = { in: ['PLAN_PRO', 'PLAN_PLATINUM'] };
  else if (kind === 'tokens') where.kind = { in: ['TOKENS_400', 'TOKENS_800', 'TOKENS_1200', 'TOKENS_2400'] };
  else if (kind) where.kind = kind;

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        kind: true,
        status: true,
        amountRub: true,
        description: true,
        yookassaPaymentId: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true, email: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  res.json({ items, total, limit: take, offset: skip });
}));

app.get('/api/admin/preset-purchases', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip } = parseAdminPage(req);
  const where = { status: 'PAID' as const };
  const [items, total] = await Promise.all([
    prisma.presetPurchase.findMany({
      where,
      orderBy: { purchasedAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        provider: true,
        purchasedAt: true,
        buyer: { select: { id: true, username: true, email: true } },
        preset: { select: { id: true, title: true, priceCents: true } },
      },
    }),
    prisma.presetPurchase.count({ where }),
  ]);
  res.json({ items, total, limit: take, offset: skip });
}));

app.get('/api/admin/users', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip, q } = parseAdminPage(req);
  const roleRaw = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
  const roleFilter = roleRaw === 'ADMIN' || roleRaw === 'USER' ? roleRaw : null;
  const where = {
    ...(roleFilter ? { role: roleFilter as 'ADMIN' | 'USER' } : {}),
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        plan: true,
        planExpiresAt: true,
        tokenBalance: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, total, limit: take, offset: skip });
}));

app.delete('/api/admin/users/:id', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.params.id;
    if (req.user?.id === userId) {
      return res.status(400).json({ error: 'Cannot delete your own admin account' });
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot delete another admin account' });
    }
    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.patch('/api/admin/users/:id/ban', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.params.id;
    if (req.user?.id === userId) {
      return res.status(400).json({ error: 'Cannot ban your own admin account' });
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot ban another admin account' });
    }
    // Soft-ban via role demotion isn't available; remove account content access by deletion for now
    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'User banned successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

app.get('/api/admin/posts', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip } = parseAdminPage(req);
  const [items, total] = await Promise.all([
    prisma.post.findMany({
      select: {
        id: true,
        content: true,
        createdAt: true,
        author: { select: { id: true, username: true } },
        media: { select: { id: true, type: true, url: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.post.count(),
  ]);
  res.json({ items, total, limit: take, offset: skip });
}));

app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    const postId = req.params.id;
    await prisma.post.delete({ where: { id: postId } });
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

app.get('/api/admin/soundtoks', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip } = parseAdminPage(req);
  const [items, total] = await Promise.all([
    prisma.soundTok.findMany({
      select: {
        id: true,
        description: true,
        videoUrl: true,
        likes: true,
        createdAt: true,
        author: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.soundTok.count(),
  ]);
  res.json({ items, total, limit: take, offset: skip });
}));

app.delete('/api/admin/soundtoks/:id', requireAdmin, async (req, res) => {
  try {
    const soundTokId = req.params.id;
    await prisma.soundTok.delete({ where: { id: soundTokId } });
    res.json({ message: 'SoundTok deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete soundtok' });
  }
});

const reportUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  role: true,
  email: true,
} as const;

app.post('/api/reports', authenticateToken, asyncRoute(async (req, res) => {
  const reportedUserId = typeof req.body?.reportedUserId === 'string' ? req.body.reportedUserId.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().toUpperCase() : '';
  const detailsRaw = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
  const details = detailsRaw.slice(0, 1000) || null;

  if (!reportedUserId) {
    return res.status(400).json({ error: 'Укажите пользователя' });
  }
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    return res.status(400).json({ error: 'Некорректная причина', allowed: REPORT_REASONS });
  }
  if (reportedUserId === req.user!.id) {
    return res.status(400).json({ error: 'Cannot report yourself' });
  }
  if (
    REPORT_REASONS_REQUIRING_DETAILS.has(reason as (typeof REPORT_REASONS)[number]) &&
    (!details || details.length < 12)
  ) {
    return res.status(400).json({ error: 'Details required for this reason' });
  }

  const target = await prisma.user.findUnique({
    where: { id: reportedUserId },
    select: { id: true, username: true, role: true },
  });
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  if (target.role === 'ADMIN') {
    return res.status(400).json({ error: 'Cannot report an admin account' });
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.userReport.count({
    where: { reporterId: req.user!.id, createdAt: { gte: hourAgo } },
  });
  if (recentCount >= 5) {
    return res.status(429).json({ error: 'Too many reports. Try again later.' });
  }

  const openDuplicate = await prisma.userReport.findFirst({
    where: {
      reporterId: req.user!.id,
      reportedId: reportedUserId,
      status: { in: ['OPEN', 'REVIEWING'] },
    },
    select: { id: true },
  });
  if (openDuplicate) {
    return res.status(409).json({
      error: 'You already have an open report against this user',
      reportId: openDuplicate.id,
    });
  }

  const report = await prisma.userReport.create({
    data: {
      reporterId: req.user!.id,
      reportedId: reportedUserId,
      reason: reason as (typeof REPORT_REASONS)[number],
      details,
    },
    select: {
      id: true,
      reason: true,
      status: true,
      details: true,
      createdAt: true,
      reported: { select: { id: true, username: true } },
    },
  });

  void sendAdminNotification(
    'Новая жалоба на пользователя',
    `Reporter: @${req.user!.username}\nReported: @${target.username}\nReason: ${reason}\nDetails: ${details || '—'}`,
  );

  res.status(201).json({ report });
}));

app.get('/api/admin/reports', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip } = parseAdminPage(req);
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'OPEN';
  const reason = typeof req.query.reason === 'string' ? req.query.reason.trim().toUpperCase() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  const where: Record<string, unknown> = {};
  if (status && status !== 'ALL' && (REPORT_STATUSES as readonly string[]).includes(status)) {
    where.status = status as (typeof REPORT_STATUSES)[number];
  }
  if (reason && (REPORT_REASONS as readonly string[]).includes(reason)) {
    where.reason = reason as (typeof REPORT_REASONS)[number];
  }
  if (q) {
    where.OR = [
      { reporter: { username: { contains: q, mode: 'insensitive' } } },
      { reported: { username: { contains: q, mode: 'insensitive' } } },
      { details: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total, openCount] = await Promise.all([
    prisma.userReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        adminNote: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        reporter: { select: reportUserSelect },
        reported: { select: reportUserSelect },
      },
    }),
    prisma.userReport.count({ where }),
    prisma.userReport.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } }),
  ]);

  const reportedIds = [...new Set(items.map((item) => item.reported.id))];
  const openAgainstRows =
    reportedIds.length > 0
      ? await prisma.userReport.groupBy({
          by: ['reportedId'],
          where: {
            reportedId: { in: reportedIds },
            status: { in: ['OPEN', 'REVIEWING'] },
          },
          _count: { _all: true },
        })
      : [];
  const openAgainstMap = new Map(
    openAgainstRows.map((row) => [row.reportedId, row._count._all]),
  );

  res.json({
    items: items.map((item) => ({
      ...item,
      openAgainstReported: openAgainstMap.get(item.reported.id) || 0,
    })),
    total,
    openCount,
    limit: take,
    offset: skip,
  });
}));

app.patch('/api/admin/reports/:id', requireAdmin, asyncRoute(async (req, res) => {
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toUpperCase() : '';
  const adminNote =
    typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 1000) : undefined;

  if (status && !(REPORT_STATUSES as readonly string[]).includes(status)) {
    return res.status(400).json({ error: 'Invalid status', allowed: REPORT_STATUSES });
  }

  const existing = await prisma.userReport.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const updated = await prisma.userReport.update({
    where: { id: req.params.id },
    data: {
      ...(status ? { status: status as (typeof REPORT_STATUSES)[number] } : {}),
      ...(adminNote !== undefined ? { adminNote: adminNote || null } : {}),
      ...((status === 'RESOLVED' || status === 'DISMISSED')
        ? { resolvedAt: new Date() }
        : status === 'OPEN' || status === 'REVIEWING'
          ? { resolvedAt: null }
          : {}),
    },
    select: {
      id: true,
      reason: true,
      details: true,
      status: true,
      adminNote: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
      reporter: { select: reportUserSelect },
      reported: { select: reportUserSelect },
    },
  });

  res.json({ report: updated });
}));

app.get('/api/users/:userId/presence', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ isOnline: getUserOnlineStatus(userId) });
  } catch (error) {
    console.error('presence error:', error);
    res.status(500).json({ error: 'Failed to fetch presence' });
  }
});

// Battle System API

// Get available users for battle invitations
app.get('/api/users/available', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const currentUserId = req.user.id;
    
    const users = await prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        role: 'USER'
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        battleElo: true,
        battleWins: true,
        battleLosses: true,
        battleDraws: true,
        createdAt: true,
        _count: {
          select: {
            createdBattles: true,
            battleParticipants: true
          }
        }
      },
      orderBy: {
        battleElo: 'desc'
      }
    });

    res.json(
      users.map((u) => ({
        ...u,
        ...battleRatingPayload(u),
      }))
    );
  } catch (error) {
    console.error('Error fetching available users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/battles/me/rating', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { battleElo: true, battleWins: true, battleLosses: true, battleDraws: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(battleRatingPayload(user));
  } catch (error) {
    console.error('Error fetching battle rating:', error);
    res.status(500).json({ error: 'Failed to fetch rating' });
  }
});

async function tryMatchBattleQueue(userId: string) {
  const me = await prisma.battleQueueEntry.findUnique({ where: { userId } });
  if (!me) return null;

  const windows = [100, 200, 400, 800, 2000];
  for (const window of windows) {
    const candidates = await prisma.battleQueueEntry.findMany({
      where: {
        userId: { not: userId },
        elo: { gte: me.elo - window, lte: me.elo + window },
      },
      orderBy: { joinedAt: 'asc' },
      take: 20,
    });
    if (!candidates.length) continue;

    // Closest elo, then oldest
    candidates.sort((a, b) => {
      const da = Math.abs(a.elo - me.elo);
      const db = Math.abs(b.elo - me.elo);
      if (da !== db) return da - db;
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    });

    const opponent = candidates[0];
    const creatorIsMe = me.joinedAt <= opponent.joinedAt;
    const creator = creatorIsMe ? me : opponent;
    const opp = creatorIsMe ? opponent : me;

    const battle = await prisma.$transaction(async (tx) => {
      // Re-check both still in queue
      const stillMe = await tx.battleQueueEntry.findUnique({ where: { userId: me.userId } });
      const stillOpp = await tx.battleQueueEntry.findUnique({ where: { userId: opponent.userId } });
      if (!stillMe || !stillOpp) return null;

      const created = await tx.battle.create({
        data: {
          title: creator.title || 'Ranked Battle',
          description: 'Подбор по рейтингу',
          creatorId: creator.userId,
          status: creator.beatUrl ? 'USER1_TURN' : 'SELECTING_BEAT',
          beatUrl: creator.beatUrl || null,
          beatName: creator.beatName || null,
          participants: {
            create: [
              { userId: creator.userId, role: 'CREATOR', acceptedAt: new Date() },
              { userId: opp.userId, role: 'OPPONENT', acceptedAt: new Date() },
            ],
          },
        },
        include: {
          creator: { select: { id: true, username: true, battleElo: true } },
          participants: {
            include: {
              user: { select: { id: true, username: true, battleElo: true, battleWins: true, battleLosses: true, battleDraws: true } },
            },
          },
          recordings: true,
          _count: { select: { recordings: true } },
        },
      });

      await tx.battleQueueEntry.deleteMany({
        where: { userId: { in: [me.userId, opponent.userId] } },
      });

      return created;
    });

    return battle;
  }

  return null;
}

app.post('/api/battles/queue', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const userId = req.user.id;
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim().slice(0, 80)
      : 'Ranked Battle';
    const beatUrl = typeof req.body?.beatUrl === 'string' ? req.body.beatUrl : null;
    const beatName = typeof req.body?.beatName === 'string' ? req.body.beatName : null;

    if (!beatUrl) {
      return res.status(400).json({ error: 'Beat is required to join ranked queue' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { battleElo: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.battleQueueEntry.upsert({
      where: { userId },
      create: {
        userId,
        elo: user.battleElo ?? BATTLE_ELO_DEFAULT,
        title,
        beatUrl,
        beatName,
      },
      update: {
        elo: user.battleElo ?? BATTLE_ELO_DEFAULT,
        title,
        beatUrl,
        beatName,
        joinedAt: new Date(),
      },
    });

    const matched = await tryMatchBattleQueue(userId);
    if (matched) {
      return res.json({ status: 'matched', battle: matched });
    }

    const waiting = await prisma.battleQueueEntry.count();
    const fullUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { battleElo: true, battleWins: true, battleLosses: true, battleDraws: true },
    });
    res.json({
      status: 'waiting',
      elo: user.battleElo ?? BATTLE_ELO_DEFAULT,
      rank: battleRatingPayload(fullUser || user),
      queueSize: waiting,
    });
  } catch (error) {
    console.error('Error joining battle queue:', error);
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

app.get('/api/battles/queue/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const userId = req.user.id;

    // If already matched into an active battle recently, surface it
    const active = await prisma.battle.findFirst({
      where: {
        status: { in: ['SELECTING_BEAT', 'USER1_TURN', 'USER2_TURN', 'JUDGING'] },
        OR: [
          { creatorId: userId },
          { participants: { some: { userId } } },
        ],
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, username: true, battleElo: true } },
        participants: {
          include: {
            user: { select: { id: true, username: true, battleElo: true, battleWins: true, battleLosses: true, battleDraws: true } },
          },
        },
        recordings: true,
        _count: { select: { recordings: true } },
      },
    });

    const entry = await prisma.battleQueueEntry.findUnique({ where: { userId } });
    if (!entry) {
      if (active) return res.json({ status: 'matched', battle: active });
      return res.json({ status: 'idle' });
    }

    const matched = await tryMatchBattleQueue(userId);
    if (matched) return res.json({ status: 'matched', battle: matched });

    const waiting = await prisma.battleQueueEntry.count();
    const fullUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { battleElo: true, battleWins: true, battleLosses: true, battleDraws: true },
    });
    res.json({
      status: 'waiting',
      elo: entry.elo,
      rank: battleRatingPayload(fullUser || { battleElo: entry.elo }),
      queueSize: waiting,
      joinedAt: entry.joinedAt,
    });
  } catch (error) {
    console.error('Error checking battle queue:', error);
    res.status(500).json({ error: 'Failed to check queue' });
  }
});

app.delete('/api/battles/queue', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    await prisma.battleQueueEntry.deleteMany({ where: { userId: req.user.id } });
    res.json({ success: true, status: 'idle' });
  } catch (error) {
    console.error('Error leaving battle queue:', error);
    res.status(500).json({ error: 'Failed to leave queue' });
  }
});

// Create new battle
app.post('/api/battles', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { title, description, opponentId } = req.body;
    const creatorId = req.user.id;
    
    if (!title || !opponentId) {
      return res.status(400).json({ error: 'Title and opponent are required' });
    }
    
    if (opponentId === creatorId) {
      return res.status(400).json({ error: 'Cannot invite yourself' });
    }
    
    // Check if opponent exists
    const opponent = await prisma.user.findUnique({
      where: { id: opponentId }
    });
    
    if (!opponent) {
      return res.status(404).json({ error: 'Opponent not found' });
    }
    
    // Create battle and participants
    const battle = await prisma.battle.create({
      data: {
        title,
        description,
        creatorId,
        status: 'INVITING',
        participants: {
          create: [
            {
              userId: creatorId,
              role: 'CREATOR',
              acceptedAt: new Date()
            },
            {
              userId: opponentId,
              role: 'OPPONENT'
            }
          ]
        }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        },
        creator: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });
    
    res.status(201).json(battle);
  } catch (error) {
    console.error('Error creating battle:', error);
    res.status(500).json({ error: 'Failed to create battle' });
  }
});

// Get user's battles
app.get('/api/battles', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = req.user.id;
    
    const battles = await prisma.battle.findMany({
      where: {
        OR: [
          { creatorId: userId },
          {
            participants: {
              some: {
                userId: userId
              }
            }
          }
        ]
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true
          }
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        },
        recordings: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        },
        _count: {
          select: {
            recordings: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    res.json(battles);
  } catch (error) {
    console.error('Error fetching battles:', error);
    res.status(500).json({ error: 'Failed to fetch battles' });
  }
});

// Get pending battle invitations
app.get('/api/battles/invitations', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = req.user.id;
    
    const invitations = await prisma.battle.findMany({
      where: {
        status: 'INVITING',
        creatorId: { not: userId }, // Исключаем создателей баттлов
        participants: {
          some: {
            userId: userId,
            role: 'OPPONENT',
            acceptedAt: null
          }
        }
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true
          }
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    res.json(invitations);
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

// Accept/decline battle invitation
app.patch('/api/battles/:id/respond', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const battleId = req.params.id;
    const userId = req.user.id;
    const { accept } = req.body;
    
    console.log(`Looking for participant: battleId=${battleId}, userId=${userId}, role=OPPONENT`);
    
    const participant = await prisma.battleParticipant.findFirst({
      where: {
        battleId,
        userId,
        role: 'OPPONENT'
      }
    });
    
    console.log(`Found participant:`, participant);
    
    if (!participant) {
      // Для диагностики выведем всех участников этого баттла
      const allParticipants = await prisma.battleParticipant.findMany({
        where: { battleId },
        include: { user: true }
      });
      console.log(`All participants for battle ${battleId}:`, allParticipants);
      return res.status(404).json({ error: 'Battle invitation not found' });
    }
    
    if (accept) {
      await prisma.battleParticipant.update({
        where: { id: participant.id },
        data: {
          acceptedAt: new Date()
        }
      });
      
      await prisma.battle.update({
        where: { id: battleId },
        data: {
          status: 'USER1_TURN'
        }
      });
    } else {
      await prisma.battle.update({
        where: { id: battleId },
        data: {
          status: 'CANCELLED'
        }
      });
    }
    
    res.json({ message: accept ? 'Battle accepted' : 'Battle declined' });
  } catch (error) {
    console.error('Error responding to battle:', error);
    res.status(500).json({ error: 'Failed to respond to battle' });
  }
});

// Update battle beat
app.patch('/api/battles/:id/beat', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const battleId = req.params.id;
    const { beatUrl, beatName } = req.body;
    
    const battle = await prisma.battle.findUnique({
      where: { id: battleId }
    });
    
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (battle.creatorId !== req.user.id) {
      return res.status(403).json({ error: 'Only battle creator can update beat' });
    }
    
    // Бит может загружать только создатель, когда статус INVITING или SELECTING_BEAT
    if (battle.status !== 'INVITING' && battle.status !== 'SELECTING_BEAT') {
      return res.status(403).json({ error: 'Battle is not in beat selection phase' });
    }
    
    await prisma.battle.update({
      where: { id: battleId },
      data: {
        beatUrl,
        beatName
      }
    });
    
    res.json({ message: 'Beat updated successfully' });
  } catch (error) {
    console.error('Error updating battle beat:', error);
    res.status(500).json({ error: 'Failed to update beat' });
  }
});

// Update battle status
app.patch('/api/battles/:id/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const battleId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['WAITING', 'INVITING', 'SELECTING_BEAT', 'USER1_TURN', 'USER2_TURN', 'JUDGING', 'FINISHED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid battle status' });
    }
    
    const battle = await prisma.battle.findUnique({
      where: { id: battleId }
    });
    
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    // Проверяем что пользователь является участником баттла
    const participant = await prisma.battleParticipant.findFirst({
      where: {
        battleId,
        userId: req.user.id
      }
    });
    
    if (!participant && battle.creatorId !== req.user.id) {
      return res.status(403).json({ error: 'You are not a participant in this battle' });
    }
    
    await prisma.battle.update({
      where: { id: battleId },
      data: { status }
    });
    
    res.json({ message: 'Battle status updated successfully' });
  } catch (error) {
    console.error('Error updating battle status:', error);
    res.status(500).json({ error: 'Failed to update battle status' });
  }
});

// Upload beat file
app.post('/api/upload/beat', authenticateToken, uploadRateLimit, upload.single('beat'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No beat file uploaded' });
    }

    const fileUrl = `/uploads/${path.basename(req.file.filename)}`;
    res.json({ url: fileUrl });
  } catch (error) {
    console.error('Error uploading beat:', error);
    res.status(500).json({ error: 'Failed to upload beat' });
  }
});

// Upload recording
app.post('/api/upload/recording', authenticateToken, uploadRateLimit, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${path.basename(req.file.filename)}`;
    res.json({ url: fileUrl });
  } catch (error) {
    console.error('Error uploading recording:', error);
    res.status(500).json({ error: 'Failed to upload recording' });
  }
});

// Get battle recordings
app.get('/api/battles/:id/recordings', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const battleId = req.params.id;
    
    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: {
        recordings: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true
              }
            }
          },
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    });

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    // Check if user is participant
    const participant = await prisma.battleParticipant.findFirst({
      where: {
        battleId,
        userId: req.user.id
      }
    });

    if (!participant && battle.creatorId !== req.user.id) {
      return res.status(403).json({ error: 'You are not a participant in this battle' });
    }

    res.json(battle.recordings);
  } catch (error) {
    console.error('Error getting battle recordings:', error);
    res.status(500).json({ error: 'Failed to get battle recordings' });
  }
});

// Save battle recording
app.post('/api/battles/:id/recordings', authenticateToken, uploadRateLimit, upload.single('audio'), async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const battleId = req.params.id;
    const userId = req.user.id;
    const { beatUrl, duration, recordingQuality } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }
    
    const voiceUrl = `/uploads/${path.basename(req.file.filename)}`;
    
    // Check if user is participant
    const participant = await prisma.battleParticipant.findFirst({
      where: {
        battleId,
        userId
      }
    });
    
    if (!participant) {
      return res.status(403).json({ error: 'Not a battle participant' });
    }
    
    // Read file as buffer and store as blob
    const fileBuffer = fs.readFileSync(path.join(uploadsDir, req.file.filename));
    
    const recording = await prisma.battleRecording.create({
      data: {
        battleId,
        userId,
        voiceUrl,
        voiceBlob: fileBuffer, // Store audio blob directly in DB
        beatUrl,
        duration: parseFloat(duration),
        recordingQuality: recordingQuality || 'medium'
      },
      include: {
        user: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });
    
    // Update battle status if both recordings are done
    const recordings = await prisma.battleRecording.findMany({
      where: { battleId },
      distinct: ['userId']
    });
    
    if (recordings.length === 2) {
      await prisma.battle.update({
        where: { id: battleId },
        data: {
          status: 'JUDGING'
        }
      });
    }
    
    res.status(201).json(recording);
  } catch (error) {
    console.error('Error saving recording:', error);
    res.status(500).json({ error: 'Failed to save recording' });
  }
});

// Get voice blob from database
app.get('/api/battles/:id/recordings/:recordingId/voice-blob', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const recordingId = req.params.recordingId;
    
    const recording = await prisma.battleRecording.findFirst({
      where: {
        id: recordingId,
        // Optional: Check if user has access to this recording
      }
    });
    
    if (!recording || !recording.voiceBlob) {
      return res.status(404).json({ error: 'Voice blob not found' });
    }
    
    // Set proper headers for audio file
    res.setHeader('Content-Type', 'audio/webm');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    // Send the blob data
    res.send(recording.voiceBlob);
  } catch (error) {
    console.error('Error getting voice blob:', error);
    res.status(500).json({ error: 'Failed to get voice blob' });
  }
});

function buildPeerRatingResult(
  battle: { creatorId: string; status: string },
  ratings: { raterId: string; rating: number }[],
  currentUserId: string
) {
  const creatorRating = ratings.find((r) => r.raterId === battle.creatorId)?.rating ?? null;
  const opponentRatingRow = ratings.find((r) => r.raterId !== battle.creatorId);
  const opponentRating = opponentRatingRow?.rating ?? null;
  const creatorReceived = opponentRating;
  const opponentReceived = creatorRating;
  const bothRated = creatorRating !== null && opponentRating !== null;

  let winner: 'USER1' | 'USER2' | 'DRAW' | undefined;
  if (bothRated && creatorReceived !== null && opponentReceived !== null) {
    if (creatorReceived > opponentReceived) winner = 'USER1';
    else if (opponentReceived > creatorReceived) winner = 'USER2';
    else winner = 'DRAW';
  }

  const hasRated = ratings.some((r) => r.raterId === currentUserId);

  return {
    creatorRating,
    opponentRating,
    creatorReceived,
    opponentReceived,
    bothRated,
    hasRated,
    winner,
    user1Score: creatorReceived,
    user2Score: opponentReceived,
    status: battle.status
  };
}

// Submit peer rating for opponent's track
app.post('/api/battles/:id/rate', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const battleId = req.params.id;
    const userId = req.user.id;
    const rating = Number(req.body.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
    }

    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: {
        participants: true,
        ratings: true
      }
    });

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    const isParticipant =
      battle.creatorId === userId ||
      battle.participants.some((p) => p.userId === userId);

    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this battle' });
    }

    if (battle.status !== 'JUDGING' && battle.status !== 'FINISHED') {
      return res.status(400).json({ error: 'Battle is not in judging phase' });
    }

    const existing = battle.ratings.find((r) => r.raterId === userId);
    if (existing) {
      return res.status(400).json({ error: 'You have already rated this battle' });
    }

    await prisma.battleRating.create({
      data: {
        battleId,
        raterId: userId,
        rating
      }
    });

    const allRatings = await prisma.battleRating.findMany({
      where: { battleId }
    });

    const result = buildPeerRatingResult(battle, allRatings, userId);

    if (result.bothRated && result.winner) {
      await prisma.battle.update({
        where: { id: battleId },
        data: {
          status: 'FINISHED',
          winner: result.winner,
          judgedBy: 'peer',
          judgedAt: new Date()
        }
      });
      await applyBattleEloResult(battleId, result.winner);
      result.status = 'FINISHED';
    }

    res.json({
      success: true,
      message: result.bothRated ? 'Both players rated — battle finished' : 'Rating saved, waiting for opponent',
      ...result
    });
  } catch (error) {
    console.error('Error submitting battle rating:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Get peer ratings for a battle
app.get('/api/battles/:id/ratings', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const battleId = req.params.id;
    const userId = req.user.id;

    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: {
        participants: true,
        ratings: true
      }
    });

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    const isParticipant =
      battle.creatorId === userId ||
      battle.participants.some((p) => p.userId === userId);

    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this battle' });
    }

    res.json(buildPeerRatingResult(battle, battle.ratings, userId));
  } catch (error) {
    console.error('Error fetching battle ratings:', error);
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

// AI Judge evaluation
app.post('/api/battles/:id/judge', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const battleId = req.params.id;
    
    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: {
        recordings: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      }
    });
    
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    if (battle.recordings.length !== 2) {
      return res.status(400).json({ error: 'Battle must have 2 recordings for judging' });
    }
    
    // AI Judge Logic (simplified version)
    const user1Recording = battle.recordings[0];
    const user2Recording = battle.recordings[1];
    
    // Simulate AI scoring with some randomness and duration-based logic
    const generateScore = (duration: number, baseScore: number = 5) => {
      const durationBonus = Math.min(duration / 30, 1) * 2; // Bonus for longer recordings
      const randomFactor = (Math.random() - 0.5) * 2; // Random variation
      return Math.max(1, Math.min(10, baseScore + durationBonus + randomFactor));
    };
    
    const user1Flow = generateScore(user1Recording.duration, 6);
    const user1Lyrics = generateScore(user1Recording.duration, 5.5);
    const user1Delivery = generateScore(user1Recording.duration, 5.8);
    const user2Flow = generateScore(user2Recording.duration, 5.5);
    const user2Lyrics = generateScore(user2Recording.duration, 6);
    const user2Delivery = generateScore(user2Recording.duration, 5.2);
    
    const user1Total = user1Flow + user1Lyrics + user1Delivery;
    const user2Total = user2Flow + user2Lyrics + user2Delivery;
    
    let winner: 'USER1' | 'USER2' | 'DRAW';
    if (user1Total > user2Total) winner = 'USER1';
    else if (user2Total > user1Total) winner = 'USER2';
    else winner = 'DRAW';
    
    // Save judge results
    const judge = await prisma.battleJudge.create({
      data: {
        battleId,
        judgeType: 'ai',
        user1Flow,
        user1Lyrics,
        user1Delivery,
        user2Flow,
        user2Lyrics,
        user2Delivery,
        user1Total,
        user2Total,
        feedback: `AI Analysis: ${winner === 'DRAW' ? 'Even match with good performances from both sides.' : winner === 'USER1' ? user1Recording.user.username + ' showed stronger flow and delivery.' : user2Recording.user.username + ' had better lyrical content and rhythm.'}`,
        confidence: 0.75 + Math.random() * 0.2
      }
    });
    
    // Update battle status
    await prisma.battle.update({
      where: { id: battleId },
      data: {
        status: 'FINISHED',
        winner,
        judgedBy: 'ai-judge',
        judgedAt: new Date()
      }
    });
    await applyBattleEloResult(battleId, winner);
    
    res.json({
      judge,
      winner,
      user1Total,
      user2Total
    });
  } catch (error) {
    console.error('Error judging battle:', error);
    res.status(500).json({ error: 'Failed to judge battle' });
  }
});

// Suno API endpoints — auth + token quota
const generateMusicSchema = z.object({
  title: z.string().trim().min(1).max(100),
  tags: z.string().trim().min(1).max(1000),
  prompt: z.string().trim().max(5000).optional(),
  translate_input: z.boolean().optional(),
  model: z.literal('v5.5').optional(),
});

app.post('/api/generate-music', authenticateToken, aiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const parsedRequest = generateMusicSchema.safeParse(req.body);
    if (!parsedRequest.success) {
      return res.status(400).json({
        error: 'Invalid generation parameters',
        details: parsedRequest.error.issues.map(issue => issue.message),
      });
    }
    const { title, tags, prompt, translate_input, model } = parsedRequest.data;

    let tokenBalanceLeft: number;
    try {
      tokenBalanceLeft = await consumeAiGenerationTokens(req.user!.id);
    } catch (e: any) {
      return res.status(e.status || 402).json({ error: e.message, code: e.code });
    }

    const apiKey = process.env.SUNO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Suno API key not configured' });
    }

    const requestBody = {
      title,
      tags,
      ...(prompt && { prompt }),
      translate_input: translate_input ?? true,
      model: model || 'v5.5'
    };

    const response = await fetch('https://api.gen-api.ru/api/v1/networks/suno', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      // refund tokens on provider failure
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { tokenBalance: { increment: TOKENS_PER_GENERATION } },
      });
      throw new Error(`Suno API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    res.json({ ...data, tokenBalance: tokenBalanceLeft, tokensCharged: TOKENS_PER_GENERATION });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Failed to generate music' });
  }
});

app.get('/api/check-generation/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    
    debugLog('CHECKING GENERATION ID:', id);
    
    if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      return res.status(400).json({ error: 'Generation ID is required' });
    }

    const apiKey = process.env.SUNO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Suno API key not configured' });
    }

    const url = `https://api.gen-api.ru/api/v1/request/get/${id}`;
    debugLog('POLLING URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    debugLog('POLLING RESPONSE STATUS:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('POLLING ERROR DETAILS:', errorText);
      throw new Error(`Polling error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    debugLog('GENERATION RESPONSE keys:', data && typeof data === 'object' ? Object.keys(data) : typeof data);

    res.json(data);
  } catch (error) {
    console.error('Polling error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to check generation' 
    });
  }
});

// ── Billing / plans / YooKassa ─────────────────────────────────
app.get('/api/billing/catalog', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    plans: PLAN_CATALOG,
    tokenPacks: TOKEN_PACKS,
    tokensPerGeneration: TOKENS_PER_GENERATION,
    paymentsEnabled: isYooKassaConfigured(),
  });
});

app.get('/api/billing/me', authenticateToken, asyncRoute(async (req, res) => {
  const snap = await getBillingSnapshot(req.user!.id);
  res.json(snap);
}));

app.post('/api/billing/create-payment', authenticateToken, asyncRoute(async (req, res) => {
  const kind = req.body?.kind as string;
  const allowed = ['PLAN_PRO', 'PLAN_PLATINUM', 'TOKENS_400', 'TOKENS_800', 'TOKENS_1200', 'TOKENS_2400'];
  if (!allowed.includes(kind)) {
    return res.status(400).json({ error: 'Invalid product kind' });
  }

  const frontend = process.env.FRONTEND_URL || 'https://soundlab-studio.ru';
  const returnUrl =
    typeof req.body?.returnUrl === 'string' && req.body.returnUrl.startsWith(frontend)
      ? req.body.returnUrl
      : `${frontend}/pricing?payment=return`;

  try {
    const created = await createYooKassaPayment({
      userId: req.user!.id,
      kind: kind as any,
      returnUrl,
    });
    // Email only after real success (webhook / sync) — click = funnel metric in admin.
    res.status(201).json(created);
  } catch (e: any) {
    const status = e.status || 500;
    res.status(status).json({
      error: e.message || 'Payment creation failed',
      ...(isProd ? {} : { details: e.details }),
    });
  }
}));

app.get('/api/billing/payments/:id', authenticateToken, asyncRoute(async (req, res) => {
  try {
    const payment = await syncPaymentStatus(req.user!.id, req.params.id);
    const snap = await getBillingSnapshot(req.user!.id);
    res.json({ payment, billing: snap });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

/** YooKassa HTTP notifications — status always re-verified via YooKassa API */
app.post('/api/billing/webhook', webhookRateLimit, async (req, res) => {
  try {
    await handleYooKassaWebhook(req.body);
    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('YooKassa webhook error:', e);
    res.status(e.status || 500).json({ error: 'Webhook failed' });
  }
});

const PORT = Number(process.env.PORT || 5002);
const HOST = process.env.HOST || '127.0.0.1';
const httpServer = createServer(app);
createSocketServer(httpServer);

httpServer.listen(PORT, HOST, () => {
  console.log(`Server on http://${HOST}:${PORT}`);
  console.log(`WebSocket ready on ws://${HOST}:${PORT}`);
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down…`);
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
