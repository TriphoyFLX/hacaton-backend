import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { createServer } from 'http';
import { createProfileRouter } from './src/routes/profileRoutes';
import { createFollowRouter } from './src/routes/followRoutes';
import { createPresetRouter } from './src/routes/presetRoutes';
import { createVerificationPayload, sendVerificationEmail, sendAdminNotification } from './src/services/emailService';
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
} from './src/services/oauthService';
import { createChatRouter } from './src/routes/chatRoutes';
import { createBlockRouter } from './src/routes/blockRoutes';
import { createSocketServer, getUserOnlineStatus } from './src/websocket/socketServer';
import { notificationService } from './src/services/notificationService';
import { rateLimitMiddleware } from './src/utils/rateLimiter';
import { corsOptions, requireJwtSecret, securityHeaders } from './src/middleware/security';
import { compressionMiddleware } from './src/middleware/compression';
import { validateMessageContent } from './src/utils/messageValidation';
import { prisma } from './src/lib/prisma';

dotenv.config();
const JWT_SECRET = requireJwtSecret();
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
const privatePresetsDir = path.join(__dirname, 'private-presets');
if (!fs.existsSync(privatePresetsDir)) {
  fs.mkdirSync(privatePresetsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadsDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const SOUNDTOK_MAX_BYTES = 15 * 1024 * 1024; // 15MB — matches SoundTok UI

const upload = multer({
  storage,
  limits: {
    fileSize: SOUNDTOK_MAX_BYTES,
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // Разрешаем изображения, видео и аудио файлы
    const allowedImageTypes = /jpeg|jpg|png|gif/;
    const allowedVideoTypes = /mp4|mov|avi|webm/;
    const allowedAudioTypes = /mp3|wav|mpeg|audio\/mpeg|audio\/wav|audio\/mp3/;
    
    const extname = file.originalname.toLowerCase();
    const mimetype = file.mimetype.toLowerCase();
    
    const isImage = allowedImageTypes.test(path.extname(extname)) || mimetype.includes('image/');
    const isVideo = allowedVideoTypes.test(path.extname(extname)) || mimetype.includes('video/');
    const isAudio = allowedAudioTypes.test(path.extname(extname)) || mimetype.includes('audio/');

    if (isImage || isVideo || isAudio) {
      return cb(null, true);
    } else {
      console.log('Debug: Rejected file:', file.originalname, 'mimetype:', file.mimetype);
      cb(new Error('Invalid file type'));
    }
  }
});

const MIDI_SAMPLE_MAX_BYTES = 6 * 1024 * 1024;
const midiSampleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MIDI_SAMPLE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname || '';
    const mime = (file.mimetype || '').toLowerCase();
    const isAudio = mime.startsWith('audio/')
      || mime === 'application/octet-stream'
      || /\.(mp3|wav|ogg|flac|m4a|aac|aiff?|webm)$/i.test(name);
    if (!isAudio) {
      console.warn('Rejected midi sample:', name, 'mimetype:', file.mimetype);
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

function signAuthToken(userId: string, role?: string) {
  return jwt.sign(
    { userId, ...(role ? { role } : {}) },
    JWT_SECRET,
    { expiresIn: '7d' }
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
      return res.status(400).json({ error: 'All fields required and terms must be accepted' });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
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
            emailVerificationCode: code,
            emailVerificationExpires: expires,
          },
        });
        await sendVerificationEmail(normalizedEmail, code);
        return res.status(200).json({
          requiresVerification: true,
          email: normalizedEmail,
          message: 'Verification code sent to your email',
        });
      }
      if (existingUser.email === normalizedEmail) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Username already exists' });
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
        emailVerificationCode: code,
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
      message: 'Verification code sent to your email',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/verify-email', authRateLimit, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.emailVerified) {
      const token = signAuthToken(user.id, user.role);
      const { password: _, emailVerificationCode: __, ...publicUser } = user as any;
      return res.json({ user: publicUser, token });
    }

    if (!user.emailVerificationCode || user.emailVerificationCode !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ error: 'Verification code expired' });
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
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/auth/resend-code', authStrictRateLimit, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const { code, expires } = createVerificationPayload();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCode: code,
        emailVerificationExpires: expires,
      },
    });
    await sendVerificationEmail(email, code);

    res.json({ message: 'Verification code resent', email });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

app.post('/api/auth/login', authStrictRateLimit, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        ...userPublicSelect,
        password: true,
      },
    });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Email not verified',
        requiresVerification: true,
        email: user.email,
      });
    }

    const token = signAuthToken(user.id, user.role);
    const { password: _, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
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
    vk: Boolean(process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET),
  });
});

app.get('/api/auth/google', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google OAuth is not configured' });
  }
  const state = oauthState();
  res.redirect(googleAuthUrl(state));
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
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
    res.redirect(`${frontendUrl()}/auth/callback?token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`${frontendUrl()}/login?error=google_failed`);
  }
});

app.get('/api/auth/vk', (_req, res) => {
  if (!process.env.VK_CLIENT_ID || !process.env.VK_CLIENT_SECRET) {
    return res.status(503).json({ error: 'VK OAuth is not configured' });
  }
  const state = oauthState();
  res.redirect(vkAuthUrl(state));
});

app.get('/api/auth/vk/callback', async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      return res.redirect(`${frontendUrl()}/login?error=vk_denied`);
    }
    const profile = await exchangeVkCode(code);
    const user = await findOrCreateOAuthUser({
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      vkId: profile.vkId,
    });
    const token = signAuthToken(user.id, user.role);
    res.redirect(`${frontendUrl()}/auth/callback?token=${encodeURIComponent(token)}`);
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
        createdAt: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
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
app.use('/api/chats', createChatRouter(authenticateToken));
app.use('/api/blocks', createBlockRouter(authenticateToken));
app.use('/api/presets', createPresetRouter(prisma, authenticateToken, uploadsDir, privatePresetsDir));

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

// Create post with media
app.post('/api/posts', upload.array('media', 10), async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { content } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!content && (!files || files.length === 0)) {
      return res.status(400).json({ error: 'Content or media required' });
    }

    // Get media type based on file extension
    const getMediaType = (filename: string): 'IMAGE' | 'VIDEO' | 'AUDIO' => {
      const ext = path.extname(filename).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) return 'IMAGE';
      if (['.mp4', '.mov', '.avi'].includes(ext)) return 'VIDEO';
      if (['.mp3', '.wav'].includes(ext)) return 'AUDIO';
      return 'IMAGE';
    };

    const mediaItems = files.map(file => ({
      type: getMediaType(file.filename),
      url: `/uploads/${file.filename}`
    }));

    const post = await prisma.post.create({
      data: {
        content,
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
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
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
        author: { select: { id: true, username: true, displayName: true, avatar: true } },
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
    const comments = await prisma.postComment.findMany({
      where: { postId: req.params.id },
      include: { author: { select: { id: true, username: true, displayName: true, avatar: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json(comments);
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
    const [comment, updated] = await prisma.$transaction([
      prisma.postComment.create({
        data: { text: validation.content, authorId: userId, postId: post.id },
        include: { author: { select: { id: true, username: true, displayName: true, avatar: true } } },
      }),
      prisma.post.update({ where: { id: post.id }, data: { commentsCount: { increment: 1 } }, select: { commentsCount: true } }),
    ]);
    void notificationService.create({
      userId: post.authorId,
      actorId: userId,
      type: 'COMMENT',
      entityType: 'post',
      entityId: post.id,
    }).catch((error) => console.error('Failed to create comment notification:', error));
    res.status(201).json({ comment, commentsCount: updated.commentsCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create comment' });
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

    const [, updated] = await prisma.$transaction([
      prisma.postComment.delete({ where: { id: comment.id } }),
      prisma.post.update({
        where: { id: comment.postId },
        data: { commentsCount: { decrement: 1 } },
        select: { commentsCount: true },
      }),
    ]);

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

// Create SoundTok (short video)
app.post('/api/soundtok', (req, res, next) => {
  upload.single('video')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Video must not exceed 15 MB' });
    }
    console.warn('SoundTok multer error:', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid video' });
  });
}, async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    debugLog('SoundTok upload', { userId: userId || null, hasFile: Boolean(req.file) });
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { description } = req.body;
    const file = req.file as Express.Multer.File;

    if (!file) {
      return res.status(400).json({ error: 'Video file required' });
    }

    const soundTok = await prisma.soundTok.create({
      data: {
        description,
        videoUrl: `/uploads/${file.filename}`,
        authorId: userId
      },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    res.status(201).json(soundTok);
  } catch (error) {
    console.error('SoundTok upload error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to create SoundTok', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

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
          likes: true,
          commentsCount: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          likesList: userId
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
    res.status(500).json({ error: 'Failed to fetch SoundToks' });
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

// Get comments for SoundTok
app.get('/api/soundtok/:id/comments', async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: {
        soundTokId: req.params.id
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(comments);
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

    const { text } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Comment text required' });
    }

    const comment = await prisma.comment.create({
      data: {
        text,
        authorId: userId,
        soundTokId: req.params.id
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
          }
        }
      }
    });

    const updated = await prisma.soundTok.update({
      where: { id: req.params.id },
      data: {
        commentsCount: {
          increment: 1
        }
      },
      select: { id: true, authorId: true, commentsCount: true }
    });

    void notificationService.create({
      userId: updated.authorId,
      actorId: userId,
      type: 'COMMENT',
      entityType: 'soundtok',
      entityId: updated.id,
    }).catch((error) => console.error('Failed to create SoundTok comment notification:', error));
    res.status(201).json({ comment, commentsCount: updated.commentsCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Search functionality
app.get('/api/search', async (req, res) => {
  try {
    const { q, type } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
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
            { username: { contains: q, mode: 'insensitive' } },
          ]
        },
        select: {
          id: true,
          username: true,
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
          content: { contains: q, mode: 'insensitive' }
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
          description: { contains: q, mode: 'insensitive' }
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

app.get('/api/admin/stats', requireAdmin, asyncRoute(async (_req, res) => {
  const now = new Date();
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

  res.json({
    totals: {
      users: usersCount,
      posts: postsCount,
      soundToks: soundToksCount,
      presetsPublished,
      pendingPayments,
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
    recent: {
      payments: recentPayments,
      presetPurchases: recentPresetPurchases,
    },
  });
}));

app.get('/api/admin/payments', requireAdmin, asyncRoute(async (req, res) => {
  const { take, skip } = parseAdminPage(req);
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'SUCCEEDED';
  const where: Record<string, unknown> = {};
  if (status && status !== 'ALL') where.status = status;
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
  const where = q
    ? {
        OR: [
          { username: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};
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
app.post('/api/upload/beat', authenticateToken, upload.single('beat'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No beat file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    console.log('Debug: Beat uploaded with URL:', fileUrl);
    res.json({ url: fileUrl });
  } catch (error) {
    console.error('Error uploading beat:', error);
    res.status(500).json({ error: 'Failed to upload beat' });
  }
});

// Upload recording
app.post('/api/upload/recording', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
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
app.post('/api/battles/:id/recordings', authenticateToken, upload.single('audio'), async (req: AuthenticatedRequest, res) => {
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
    
    const voiceUrl = `/uploads/${req.file.filename}`;
    
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

app.post('/api/generate-music', authenticateToken, async (req: AuthenticatedRequest, res) => {
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
    
    if (!id) {
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
    void sendAdminNotification(
      'Новый платёж YooKassa',
      `User: ${req.user!.username}\nKind: ${kind}\nAmount: ${created.amountRub} ₽\nPayment: ${created.paymentId}`,
    );
    res.status(201).json(created);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message, details: e.details });
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

/** YooKassa HTTP notifications */
app.post('/api/billing/webhook', async (req, res) => {
  try {
    await handleYooKassaWebhook(req.body);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('YooKassa webhook error:', e);
    res.status(500).json({ error: 'Webhook failed' });
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
