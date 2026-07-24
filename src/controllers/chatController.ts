import { Request, Response } from 'express';
import fs from 'fs';
import { chatService } from '../services/chatService';
import { userRepository } from '../repositories/userRepository';
import { chatRepository } from '../repositories/chatRepository';
import { blockService } from '../services/blockService';
import { AuthenticatedRequest } from '../types';
import { validateMessageContent } from '../utils/messageValidation';
import { checkRateLimit, messageRateLimitKey } from '../utils/rateLimiter';
import { getIO } from '../websocket/socketServer';
import { notificationService } from '../services/notificationService';
import { deleteAvatarFile } from '../utils/profileUtils';

const MESSAGE_RATE_LIMIT = 30;
const MESSAGE_RATE_WINDOW_MS = 60_000;
const GROUP_CREATE_RATE_LIMIT = 5;
const GROUP_CREATE_RATE_WINDOW_MS = 60 * 60_000;
const MAX_READ_MESSAGE_IDS = 100;

function formatChat(chat: any, currentUserId: string, unreadCount = 0) {
  const currentMembership = chat.users.find((u: any) => u.userId === currentUserId);
  const otherUser = chat.type === 'DIRECT'
    ? chat.users.find((u: any) => u.user.id !== currentUserId)?.user
    : null;

  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    avatar: chat.avatar ?? null,
    creatorId: chat.creatorId,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    unreadCount,
    isPinned: !!currentMembership?.pinnedAt,
    pinnedAt: currentMembership?.pinnedAt ?? null,
    myRole: currentMembership?.role ?? 'MEMBER',
    memberCount: chat.users.length,
    otherUser: otherUser
      ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.displayName,
          avatar: otherUser.avatar,
        }
      : null,
    users: chat.users.map((cu: any) => ({
      id: cu.id,
      userId: cu.userId,
      chatId: cu.chatId,
      role: cu.role ?? 'MEMBER',
      pinnedAt: cu.pinnedAt,
      createdAt: cu.createdAt,
      user: {
        id: cu.user.id,
        username: cu.user.username,
        displayName: cu.user.displayName,
        avatar: cu.user.avatar,
      },
    })),
    messages: chat.messages || [],
  };
}

/**
 * Get total unread message count
 */
export async function getUnreadTotal(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const total = await chatService.getUnreadTotal(req.user.id);
    res.json({ total });
  } catch (error) {
    console.error('getUnreadTotal error:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
}

/**
 * Get chats for current user (paginated)
 */
export async function getChats(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rawLimit = Number.parseInt(String(req.query.limit ?? '40'), 10);
    const rawOffset = Number.parseInt(String(req.query.offset ?? '0'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 40;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const page = await chatService.getUserChats(req.user.id, { limit, offset });
    const unreadCounts = await chatService.getUnreadCounts(
      req.user.id,
      page.items.map((chat) => chat.id),
    );

    const items = page.items.map((chat) =>
      formatChat(chat, req.user!.id, unreadCounts.get(chat.id) || 0),
    );

    res.json({
      items,
      total: page.total,
      hasMore: page.hasMore,
      limit: page.limit,
      offset: page.offset,
    });
  } catch (error) {
    console.error('getChats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
}

/**
 * Get messages for a specific chat
 */
export async function getMessages(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { chatId } = req.params;
    const { cursor, limit = '50' } = req.query;
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;

    const chatInfo = await chatService.getChatHistory(chatId, req.user.id, {
      cursor: typeof cursor === 'string' && cursor.length <= 128 ? cursor : undefined,
      limit: safeLimit,
    });

    if (!chatInfo) {
      return res.status(403).json({ error: 'Access denied or chat not found' });
    }

    res.json({
      chat: formatChat(chatInfo.chat, req.user.id, chatInfo.unreadCount),
      messages: chatInfo.messages,
      unreadCount: chatInfo.unreadCount,
    });
  } catch (error) {
    console.error('getMessages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

/**
 * Create a new chat with another user
 */
export async function createChat(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { receiverId } = req.body;

    if (!receiverId) {
      return res.status(400).json({ error: 'Receiver ID required' });
    }

    if (receiverId === req.user.id) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }

    const isBlocked = await blockService.isEitherBlocked(req.user.id, receiverId);
    if (isBlocked) {
      return res.status(403).json({ error: 'Невозможно начать чат с этим пользователем' });
    }

    const chat = await chatService.createOrGetChat(req.user.id, receiverId);

    if (!chat) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otherUser = chat.users.find((u: { user: { id: string } }) => u.user.id !== req.user!.id)?.user;

    res.status(201).json(formatChat(chat, req.user.id, 0));
  } catch (error) {
    console.error('createChat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
}

export async function createGroup(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, memberIds } = req.body;

    if (!Array.isArray(memberIds)) {
      return res.status(400).json({ error: 'memberIds must be an array' });
    }
    const rateLimit = checkRateLimit(
      `group-create:${req.user.id}`,
      GROUP_CREATE_RATE_LIMIT,
      GROUP_CREATE_RATE_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Слишком много новых групп. Попробуйте позже.',
        retryAfterMs: rateLimit.retryAfterMs,
      });
    }

    const result = await chatService.createGroup(req.user.id, name, memberIds);
    if (!result.success || !result.chat) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(formatChat(result.chat, req.user.id, 0));
  } catch (error) {
    console.error('createGroup error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
}

export async function renameGroup(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId } = req.params;
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const result = await chatService.renameGroup(chatId, req.user.id, name);
    if (!result.success || !result.chat) {
      return res.status(400).json({ error: result.error || 'Не удалось переименовать' });
    }
    const formatted = formatChat(result.chat, req.user.id, 0);
    getIO()?.to(`chat:${chatId}`).emit('chat:updated', formatted);
    res.json(formatted);
  } catch (error) {
    console.error('renameGroup error:', error);
    res.status(500).json({ error: 'Не удалось переименовать группу' });
  }
}

export async function addGroupMembers(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId } = req.params;
    const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    const result = await chatService.addGroupMembers(chatId, req.user.id, memberIds);
    if (!result.success || !result.chat) {
      return res.status(400).json({ error: result.error || 'Не удалось добавить' });
    }
    const formatted = formatChat(result.chat, req.user.id, 0);
    getIO()?.to(`chat:${chatId}`).emit('chat:updated', formatted);
    for (const memberId of memberIds) {
      if (typeof memberId === 'string') {
        getIO()?.to(`user:${memberId}`).emit('chat:updated', formatted);
      }
    }
    res.json(formatted);
  } catch (error) {
    console.error('addGroupMembers error:', error);
    res.status(500).json({ error: 'Не удалось добавить участников' });
  }
}

export async function pinChat(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { chatId } = req.params;
    const { pinned } = req.body;

    if (typeof pinned !== 'boolean') {
      return res.status(400).json({ error: 'pinned must be boolean' });
    }

    const result = await chatService.togglePin(chatId, req.user.id, pinned);
    if (!result.success) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      pinned,
      isPinned: !!result.pinnedAt,
      pinnedAt: result.pinnedAt,
    });
  } catch (error) {
    console.error('pinChat error:', error);
    res.status(500).json({ error: 'Failed to pin chat' });
  }
}

/**
 * Send a message via REST API (fallback when WebSocket unavailable)
 */
export async function sendMessage(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { chatId } = req.params;
    const { content, clientMessageId, receiverId: bodyReceiverId, soundTokId, replyToId, imageUrl } = req.body;

    const validation = validateMessageContent(content, {
      allowEmpty: !!soundTokId || !!imageUrl,
    });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    if (!soundTokId && !imageUrl && !validation.content) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    if (clientMessageId !== undefined && (typeof clientMessageId !== 'string' || clientMessageId.length < 1 || clientMessageId.length > 128)) {
      return res.status(400).json({ error: 'Invalid client message ID' });
    }

    const rateLimit = checkRateLimit(
      messageRateLimitKey(req.user.id),
      MESSAGE_RATE_LIMIT,
      MESSAGE_RATE_WINDOW_MS
    );
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Слишком много сообщений. Подождите немного.',
        retryAfterMs: rateLimit.retryAfterMs,
      });
    }

    const isMember = await chatRepository.isChatMember(chatId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const receiverId = bodyReceiverId || await chatRepository.getOtherParticipant(chatId, req.user.id);

    if (replyToId !== undefined && replyToId !== null && typeof replyToId !== 'string') {
      return res.status(400).json({ error: 'Invalid replyToId' });
    }

    const result = await chatService.sendMessage({
      content: validation.content ?? '',
      senderId: req.user.id,
      receiverId: receiverId ?? null,
      chatId,
      clientMessageId: clientMessageId || `${req.user.id}_${Date.now()}`,
      soundTokId: typeof soundTokId === 'string' ? soundTokId : null,
      replyToId: typeof replyToId === 'string' ? replyToId : null,
      imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
    });

    if (!result.success || !result.message) {
      return res.status(400).json({ error: result.error });
    }

    getIO()?.to(`chat:${chatId}`).emit('message:new', result.message);
    if (result.message.receiverId) {
      void notificationService.create({
        userId: result.message.receiverId,
        actorId: req.user.id,
        type: 'MESSAGE',
        entityType: 'chat',
        entityId: chatId,
      }).catch((error) => console.error('Failed to create message notification:', error));
    }

    res.status(201).json(result.message);
  } catch (error) {
    console.error('sendMessage error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

export async function deleteMessage(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId, messageId } = req.params;
    const result = await chatService.deleteMessage(chatId, messageId, req.user.id);
    if (!result.success || !result.message) {
      return res.status(result.error === 'Access denied' ? 403 : 404).json({ error: result.error || 'Failed to delete message' });
    }
    getIO()?.to(`chat:${chatId}`).emit('message:deleted', { chatId, message: result.message });
    res.json(result.message);
  } catch (error) {
    console.error('deleteMessage error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
}

export async function editMessage(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId, messageId } = req.params;
    const result = await chatService.editMessage(chatId, messageId, req.user.id, req.body?.content);
    if (!result.success || !result.message) {
      const status =
        result.error === 'Access denied' ? 403
        : result.error === 'Message not found or empty' ? 404
        : 400;
      return res.status(status).json({ error: result.error || 'Failed to edit message' });
    }
    getIO()?.to(`chat:${chatId}`).emit('message:edited', { chatId, message: result.message });
    res.json(result.message);
  } catch (error) {
    console.error('editMessage error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
}

export async function toggleMessageReaction(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId, messageId } = req.params;
    const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
    if (!emoji) return res.status(400).json({ error: 'Emoji is required' });

    const result = await chatService.toggleReaction(chatId, messageId, req.user.id, emoji);
    if (!result.success || !result.message) {
      return res.status(result.error === 'Access denied' ? 403 : 400).json({ error: result.error || 'Failed to react' });
    }
    getIO()?.to(`chat:${chatId}`).emit('message:reaction', { chatId, message: result.message });
    res.json({ message: result.message, added: result.added });
  } catch (error) {
    console.error('toggleMessageReaction error:', error);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
}

/**
 * Mark messages as read
 */
export async function markAsRead(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { chatId } = req.params;
    const { messageIds } = req.body;

    if (!Array.isArray(messageIds)) {
      return res.status(400).json({ error: 'Message IDs array required' });
    }
    if (messageIds.length > MAX_READ_MESSAGE_IDS || messageIds.some((id) => typeof id !== 'string' || id.length > 128)) {
      return res.status(400).json({ error: `At most ${MAX_READ_MESSAGE_IDS} valid message IDs are allowed` });
    }

    const result = await chatService.markMessagesAsRead(
      messageIds,
      req.user.id,
      chatId
    );

    res.json({ count: result.count });
  } catch (error) {
    console.error('markAsRead error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
}

/**
 * Get available users to chat with
 */
export async function getAvailableUsers(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const users = await userRepository.searchUsers(q, 10);
    
    // Exclude current user and format
    const formatted = users
      .filter(u => u.id !== req.user!.id)
      .map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        bio: u.bio,
      }));

    res.json(formatted);
  } catch (error) {
    console.error('getAvailableUsers error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
}

export async function uploadChatImage(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const isMember = await chatRepository.isChatMember(chatId, req.user.id);
    if (!isMember) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ error: 'Нет доступа к чату' });
    }

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ error: 'Допустимы JPEG, PNG, GIF, WEBP' });
    }

    res.json({ imageUrl: `/uploads/${req.file.filename}` });
  } catch (error) {
    console.error('uploadChatImage error:', error);
    res.status(500).json({ error: 'Не удалось загрузить изображение' });
  }
}

export async function uploadGroupAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ error: 'Допустимы JPEG, PNG, GIF, WEBP' });
    }

    const avatarUrl = `/uploads/${req.file.filename}`;
    const result = await chatService.updateGroupAvatar(chatId, req.user.id, avatarUrl);
    if (!result.success || !result.chat) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ error: result.error || 'Не удалось обновить фото' });
    }

    const formatted = formatChat(result.chat, req.user.id, 0);
    getIO()?.to(`chat:${chatId}`).emit('chat:updated', formatted);
    res.json(formatted);
  } catch (error) {
    console.error('uploadGroupAvatar error:', error);
    res.status(500).json({ error: 'Не удалось обновить фото группы' });
  }
}

export async function deleteGroupAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId } = req.params;
    const meta = await chatRepository.getChatMeta(chatId);
    const result = await chatService.updateGroupAvatar(chatId, req.user.id, null);
    if (!result.success || !result.chat) {
      return res.status(403).json({ error: result.error || 'Не удалось удалить фото' });
    }
    if (meta?.avatar) {
      deleteAvatarFile(meta.avatar);
    }
    const formatted = formatChat(result.chat, req.user.id, 0);
    getIO()?.to(`chat:${chatId}`).emit('chat:updated', formatted);
    res.json(formatted);
  } catch (error) {
    console.error('deleteGroupAvatar error:', error);
    res.status(500).json({ error: 'Не удалось удалить фото группы' });
  }
}

export async function setGroupMemberRole(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId, userId } = req.params;
    const role = req.body?.role;
    if (role !== 'ADMIN' && role !== 'MEMBER') {
      return res.status(400).json({ error: 'role должен быть ADMIN или MEMBER' });
    }
    const result = await chatService.setMemberRole(chatId, req.user.id, userId, role);
    if (!result.success) {
      return res.status(403).json({ error: result.error });
    }
    const chat = await chatRepository.getChatById(chatId);
    if (chat) {
      const formatted = formatChat(chat, req.user.id, 0);
      getIO()?.to(`chat:${chatId}`).emit('chat:updated', formatted);
      res.json(formatted);
      return;
    }
    res.json({ userId: result.userId, role: result.role });
  } catch (error) {
    console.error('setGroupMemberRole error:', error);
    res.status(500).json({ error: 'Не удалось изменить роль' });
  }
}

export async function removeGroupMember(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { chatId, userId } = req.params;
    const result = await chatService.removeMember(chatId, req.user.id, userId);
    if (!result.success) {
      return res.status(403).json({ error: result.error });
    }
    if (userId === req.user.id) {
      getIO()?.to(`chat:${chatId}`).emit('chat:member-left', { chatId, userId });
      return res.json({ success: true, left: true });
    }
    const chat = await chatRepository.getChatById(chatId);
    if (chat) {
      const formatted = formatChat(chat, req.user.id, 0);
      getIO()?.to(`chat:${chatId}`).emit('chat:updated', formatted);
      res.json(formatted);
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('removeGroupMember error:', error);
    res.status(500).json({ error: 'Не удалось удалить участника' });
  }
}
