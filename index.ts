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
      },
      select: {
        id: true,
        username: true,
        email: true,
        birthDate: true,
        agreedToTerms: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
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

    const user = await prisma.user.findUnique({ 
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        birthDate: true,
        agreedToTerms: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        password: true
      }
    });
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

// Helper function to get user ID from token
const getUserFromToken = (authHeader?: string) => {
  if (!authHeader) return null;
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true }
    });
    return user?.role === 'ADMIN';
  } catch {
    return false;
  }
};

// Admin middleware
const requireAdmin = async (req: any, res: any, next: any) => {
  if (!(await isAdmin(req.headers.authorization))) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
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

// Chat functionality
app.get('/api/chats', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const chats = await prisma.chat.findMany({
      where: {
        users: {
          some: {
            userId: userId
          }
        }
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        },
        messages: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    res.json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/chats/:id/messages', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const chatId = req.params.id;

    // Check if user is part of the chat
    const chatUser = await prisma.chatUser.findFirst({
      where: {
        chatId,
        userId
      }
    });

    if (!chatUser) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await prisma.message.findMany({
      where: {
        chatId
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/chats', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { receiverId } = req.body;

    if (!receiverId) {
      return res.status(400).json({ error: 'Receiver ID required' });
    }

    if (receiverId === userId) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }

    // Check if chat already exists
    const existingChat = await prisma.chat.findFirst({
      where: {
        users: {
          every: {
            userId: {
              in: [userId, receiverId]
            }
          }
        }
      },
      include: {
        users: true
      }
    });

    if (existingChat && existingChat.users.length === 2) {
      return res.json(existingChat);
    }

    // Create new chat
    const chat = await prisma.chat.create({
      data: {
        users: {
          create: [
            { userId },
            { userId: receiverId }
          ]
        }
      },
      include: {
        users: {
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

    res.status(201).json(chat);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.post('/api/chats/:id/messages', async (req, res) => {
  try {
    const userId = getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const chatId = req.params.id;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content required' });
    }

    // Check if user is part of the chat
    const chatUser = await prisma.chatUser.findFirst({
      where: {
        chatId,
        userId
      }
    });

    if (!chatUser) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Find receiver (the other user in the chat)
    const otherUser = await prisma.chatUser.findFirst({
      where: {
        chatId,
        userId: {
          not: userId
        }
      }
    });

    if (!otherUser) {
      return res.status(400).json({ error: 'Chat must have two users' });
    }

    const message = await prisma.message.create({
      data: {
        content,
        senderId: userId,
        receiverId: otherUser.userId,
        chatId
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    // Update chat timestamp
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() }
    });

    res.status(201).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Admin endpoints
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.patch('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    // В реальном приложении здесь можно добавить поле banned в User model
    // Пока просто удаляем пользователя как пример
    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'User banned successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

app.get('/api/admin/posts', requireAdmin, async (req, res) => {
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
      orderBy: { createdAt: 'desc' }
    });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    const postId = req.params.id;
    await prisma.post.delete({ where: { id: postId } });
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

app.get('/api/admin/soundtoks', requireAdmin, async (req, res) => {
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
      orderBy: { createdAt: 'desc' }
    });
    res.json(soundToks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch soundtoks' });
  }
});

app.delete('/api/admin/soundtoks/:id', requireAdmin, async (req, res) => {
  try {
    const soundTokId = req.params.id;
    await prisma.soundTok.delete({ where: { id: soundTokId } });
    res.json({ message: 'SoundTok deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete soundtok' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
