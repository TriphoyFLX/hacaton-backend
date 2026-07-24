import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import {
  getChats,
  getMessages,
  createChat,
  createGroup,
  pinChat,
  sendMessage,
  deleteMessage,
  editMessage,
  toggleMessageReaction,
  markAsRead,
  getAvailableUsers,
  getUnreadTotal,
  uploadChatImage,
  uploadGroupAvatar,
  deleteGroupAvatar,
  setGroupMemberRole,
  removeGroupMember,
} from '../controllers/chatController';
import { AuthenticatedRequest } from '../types';

type AuthMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export function createChatRouter(
  authenticateToken: AuthMiddleware,
  uploadsDir: string
): Router {
  const router = Router();

  const imageUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp/;
      const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
      const mimeOk = file.mimetype.startsWith('image/');
      if (extOk && mimeOk) cb(null, true);
      else cb(new Error('Invalid file type. Allowed: JPEG, PNG, GIF, WEBP'));
    },
  });

  const handleImageUpload = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    imageUpload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Файл слишком большой. Макс. 8MB' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  };

  router.get('/', authenticateToken, getChats);
  router.get('/unread/total', authenticateToken, getUnreadTotal);
  router.get('/users/search', authenticateToken, getAvailableUsers);
  router.get('/:chatId/messages', authenticateToken, getMessages);
  router.post('/group', authenticateToken, createGroup);
  router.post('/', authenticateToken, createChat);
  router.patch('/:chatId/pin', authenticateToken, pinChat);
  router.post('/:chatId/messages', authenticateToken, sendMessage);
  router.post('/:chatId/images', authenticateToken, handleImageUpload, uploadChatImage);
  router.post('/:chatId/avatar', authenticateToken, handleImageUpload, uploadGroupAvatar);
  router.delete('/:chatId/avatar', authenticateToken, deleteGroupAvatar);
  router.patch('/:chatId/members/:userId/role', authenticateToken, setGroupMemberRole);
  router.delete('/:chatId/members/:userId', authenticateToken, removeGroupMember);
  router.patch('/:chatId/messages/:messageId', authenticateToken, editMessage);
  router.delete('/:chatId/messages/:messageId', authenticateToken, deleteMessage);
  router.post('/:chatId/messages/:messageId/reactions', authenticateToken, toggleMessageReaction);
  router.post('/:chatId/read', authenticateToken, markAsRead);

  return router;
}
