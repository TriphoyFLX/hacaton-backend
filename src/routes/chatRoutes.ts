import { Router } from 'express';
import {
  getChats,
  getMessages,
  createChat,
  createGroup,
  pinChat,
  sendMessage,
  deleteMessage,
  toggleMessageReaction,
  markAsRead,
  getAvailableUsers,
  getUnreadTotal,
} from '../controllers/chatController';
import { AuthenticatedRequest } from '../types';

type AuthMiddleware = (
  req: AuthenticatedRequest,
  res: any,
  next: any
) => void | Promise<void>;

export function createChatRouter(authenticateToken: AuthMiddleware): Router {
  const router = Router();

  router.get('/', authenticateToken, getChats);
  router.get('/unread/total', authenticateToken, getUnreadTotal);
  router.get('/users/search', authenticateToken, getAvailableUsers);
  router.get('/:chatId/messages', authenticateToken, getMessages);
  router.post('/group', authenticateToken, createGroup);
  router.post('/', authenticateToken, createChat);
  router.patch('/:chatId/pin', authenticateToken, pinChat);
  router.post('/:chatId/messages', authenticateToken, sendMessage);
  router.delete('/:chatId/messages/:messageId', authenticateToken, deleteMessage);
  router.post('/:chatId/messages/:messageId/reactions', authenticateToken, toggleMessageReaction);
  router.post('/:chatId/read', authenticateToken, markAsRead);

  return router;
}
