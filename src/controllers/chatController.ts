import { Request, Response } from 'express';
import { chatService } from '../services/chatService';
import { userRepository } from '../repositories/userRepository';
import { chatRepository } from '../repositories/chatRepository';
import { AuthenticatedRequest } from '../types';

/**
 * Get all chats for current user
 */
export async function getChats(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const chats = await chatService.getUserChats(req.user.id);
    
    // Format chats with other user info and last message
    const formattedChats = chats.map(chat => {
      const otherUser = chat.users.find(u => u.user.id !== req.user!.id)?.user;
      
      return {
        id: chat.id,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        otherUser: otherUser ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.displayName,
          avatar: otherUser.avatar,
        } : null,
        // Messages are already included via Prisma include
        messages: (chat as any).messages || [],
      };
    });

    res.json(formattedChats);
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

    const chatInfo = await chatService.getChatHistory(chatId, req.user.id, {
      cursor: cursor as string | undefined,
      limit: parseInt(limit as string, 10),
    });

    if (!chatInfo) {
      return res.status(403).json({ error: 'Access denied or chat not found' });
    }

    res.json({
      chat: chatInfo.chat,
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

    const chat = await chatService.createOrGetChat(req.user.id, receiverId);

    if (!chat) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otherUser = chat.users.find(u => u.user.id !== req.user!.id)?.user;

    res.status(201).json({
      id: chat.id,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      otherUser: otherUser ? {
        id: otherUser.id,
        username: otherUser.username,
        displayName: otherUser.displayName,
        avatar: otherUser.avatar,
      } : null,
      users: chat.users.map(cu => ({
        id: cu.id,
        userId: cu.userId,
        chatId: cu.chatId,
        createdAt: cu.createdAt,
        user: {
          id: cu.user.id,
          username: cu.user.username,
          displayName: cu.user.displayName,
          avatar: cu.user.avatar,
        },
      })),
    });
  } catch (error) {
    console.error('createChat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
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
    const { content, clientMessageId, receiverId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content required' });
    }

    if (!receiverId) {
      return res.status(400).json({ error: 'Receiver ID required' });
    }

    // Check if user is in chat
    const isMember = await chatRepository.isChatMember(chatId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const result = await chatService.sendMessage({
      content: content.trim(),
      senderId: req.user.id,
      receiverId,
      chatId,
      clientMessageId: clientMessageId || `${req.user.id}_${Date.now()}`,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result.message);
  } catch (error) {
    console.error('sendMessage error:', error);
    res.status(500).json({ error: 'Failed to send message' });
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

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Message IDs array required' });
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
