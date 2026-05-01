import express, { Request } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|mp3|wav/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, birthDate, agreedToTerms } = req.body;

    if (!username || !email || !password || !birthDate || !agreedToTerms) {
      return res.status(400).json({ error: 'All fields required and terms must be accepted' });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        birthDate: new Date(birthDate),
        agreedToTerms
      }
    });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, username: true, birthDate: true, createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Helper function to get user from token
const getUserFromToken = (authHeader: string | undefined) => {
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
};

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
            username: true
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

// Get all posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
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
      }
    });

    res.json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Create SoundTok (short video)
app.post('/api/soundtok', upload.single('video'), async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
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
    console.error(error);
    res.status(500).json({ error: 'Failed to create SoundTok' });
  }
});

// Get all SoundToks
app.get('/api/soundtok', async (req, res) => {
  try {
    const soundToks = await prisma.soundTok.findMany({
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
      }
    });

    res.json(soundToks);
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

    const soundTok = await prisma.soundTok.update({
      where: { id: req.params.id },
      data: {
        likes: {
          increment: 1
        }
      }
    });

    res.json(soundTok);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to like SoundTok' });
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
            { email: { contains: q, mode: 'insensitive' } }
          ]
        },
        select: {
          id: true,
          username: true,
          email: true,
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
