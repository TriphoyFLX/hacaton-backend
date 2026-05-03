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
console.log("ENV LOADED:", process.env.SUNO_API_KEY);
console.log('RAW ENV FILE:\n', fs.readFileSync('.env', 'utf8'));
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
    // Разрешаем изображения, видео и аудио файлы
    const allowedImageTypes = /jpeg|jpg|png|gif/;
    const allowedVideoTypes = /mp4|mov|avi/;
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
console.log('SUNO KEY:', process.env.SUNO_API_KEY);
app.use(cors());
console.log('CWD:', process.cwd());

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

    res.status(201).json({ user, token });
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

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { userId: string; role: string };
    
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
    return res.status(401).json({ error: 'Invalid token' });
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
    const userId = getUserFromToken(req.headers.authorization);
    
    const soundToks = await prisma.soundTok.findMany({
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        },
        likesList: userId ? {
          where: {
            userId: userId
          }
        } : false
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Add isLiked field to each SoundTok
    const soundToksWithIsLiked = soundToks.map(soundTok => ({
      ...soundTok,
      isLiked: userId ? soundTok.likesList.length > 0 : false,
      likesList: undefined // Remove likesList from response
    }));

    res.json(soundToksWithIsLiked);
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

    res.json(soundTok);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to like SoundTok' });
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
            username: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
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
            username: true
          }
        }
      }
    });

    // Increment comments count
    await prisma.soundTok.update({
      where: { id: req.params.id },
      data: {
        commentsCount: {
          increment: 1
        }
      }
    });

    res.status(201).json(comment);
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
        createdAt: true,
        _count: {
          select: {
            createdBattles: true,
            battleParticipants: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching available users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
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

    const fileUrl = `http://localhost:5002/uploads/${req.file.filename}`;
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

// Suno API endpoints
app.post('/api/generate-music', async (req, res) => {
  try {
    const { title, tags, prompt, translate_input, model } = req.body;
    
    if (!title || !tags) {
      return res.status(400).json({ error: 'Title and tags are required' });
    }

    const apiKey = process.env.SUNO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Suno API key not configured' });
    }

    const requestBody = {
      title,
      tags,
      ...(prompt && { prompt }),
      translate_input: translate_input || true,
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
      throw new Error(`Suno API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate music' 
    });
  }
});

app.get('/api/check-generation/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('CHECKING GENERATION ID:', id);
    
    if (!id) {
      return res.status(400).json({ error: 'Generation ID is required' });
    }

    const apiKey = process.env.SUNO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Suno API key not configured' });
    }

    const url = `https://api.gen-api.ru/api/v1/request/get/${id}`;
    console.log('POLLING URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    console.log('POLLING RESPONSE STATUS:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('POLLING ERROR DETAILS:', errorText);
      throw new Error(`Polling error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('GENERATION RESPONSE:', data);

    res.json(data);
  } catch (error) {
    console.error('Polling error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to check generation' 
    });
  }
});

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
