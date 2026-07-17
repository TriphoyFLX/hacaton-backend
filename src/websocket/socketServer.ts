import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { chatService } from '../services/chatService';
import { chatRepository } from '../repositories/chatRepository';
import { profileService } from '../services/profileService';
import { validateMessageContent } from '../utils/messageValidation';
import { checkRateLimit, messageRateLimitKey } from '../utils/rateLimiter';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  MessageResponse,
} from '../types';

type AuthenticatedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
> & {
  userId?: string;
  username?: string;
};

// Map of userId -> Set of socket IDs (for multiple device support)
const userSockets = new Map<string, Set<string>>();
// Map of chatId -> Set of user IDs currently in chat
const activeChatUsers = new Map<string, Set<string>>();

let ioInstance: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Reconnection settings
      pingTimeout: 60000,
      pingInterval: 25000,
      connectTimeout: 10000,
    }
  );

  ioInstance = io;

  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(
        token as string,
        process.env.JWT_SECRET || 'secret'
      ) as { userId: string; username: string };

      // Verify user exists
      const user = await profileService.getProfile(decoded.userId);
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      socket.username = user.username;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    const username = socket.username!;

    console.log(`[Socket] User connected: ${username} (${userId})`);

    // Track user's sockets (multiple devices)
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    // Notify subscribers about online status
    io.to(`user:${userId}`).emit('user:online', { userId, isOnline: true });

    activeChatUsers.forEach((users, chatId) => {
      if (users.has(userId)) {
        io.to(`chat:${chatId}`).emit('chat:presence', {
          chatId,
          userId,
          isOnline: true,
        });
      }
    });

    // ─────────────────────────────────────────
    // CHAT EVENTS
    // ─────────────────────────────────────────

    // Join chat room
    socket.on('chat:join', async (chatId: string) => {
      try {
        const isMember = await chatRepository.isChatMember(chatId, userId);
        if (!isMember) {
          socket.emit('error', { message: 'Not a member of this chat', code: 'NOT_MEMBER' });
          return;
        }

        socket.join(`chat:${chatId}`);
        
        // Track active users in chat
        if (!activeChatUsers.has(chatId)) {
          activeChatUsers.set(chatId, new Set());
        }
        activeChatUsers.get(chatId)!.add(userId);

        const participants = await chatRepository.getChatParticipants(chatId);
        for (const participantId of participants) {
          if (participantId === userId) continue;
          socket.emit('chat:presence', {
            chatId,
            userId: participantId,
            isOnline: userSockets.has(participantId),
          });
        }

        socket.to(`chat:${chatId}`).emit('chat:presence', {
          chatId,
          userId,
          isOnline: true,
        });

        // Mark messages as delivered since user is now active
        const deliveredIds = await chatService.markChatAsDelivered(chatId, userId);
        
        // Notify other users about delivered messages
        deliveredIds.forEach(messageId => {
          socket.to(`chat:${chatId}`).emit('message:delivered', { 
            clientMessageId: '', 
            messageId 
          });
        });

        console.log(`[Socket] ${username} joined chat ${chatId}`);
      } catch (error) {
        console.error('[Socket] Error joining chat:', error);
        socket.emit('error', { message: 'Failed to join chat', code: 'JOIN_ERROR' });
      }
    });

    // Leave chat room
    socket.on('chat:leave', (chatId: string) => {
      socket.leave(`chat:${chatId}`);
      
      const chatUsers = activeChatUsers.get(chatId);
      if (chatUsers) {
        chatUsers.delete(userId);
        if (chatUsers.size === 0) {
          activeChatUsers.delete(chatId);
        }
      }

      socket.to(`chat:${chatId}`).emit('chat:presence', {
        chatId,
        userId,
        isOnline: userSockets.has(userId),
      });

      console.log(`[Socket] ${username} left chat ${chatId}`);
    });

    // Send message
    socket.on('message:send', async (data, callback) => {
      try {
        const validation = validateMessageContent(data.content, {
          allowEmpty: !!data.soundTokId,
        });
        if (!validation.valid) {
          callback({
            success: false,
            error: validation.error,
            clientMessageId: data.clientMessageId,
          });
          return;
        }

        if (!data.soundTokId && !validation.content) {
          callback({
            success: false,
            error: 'Сообщение не может быть пустым',
            clientMessageId: data.clientMessageId,
          });
          return;
        }

        const rateLimit = checkRateLimit(
          messageRateLimitKey(userId),
          30,
          60_000
        );
        if (!rateLimit.allowed) {
          callback({
            success: false,
            error: 'Слишком много сообщений. Подождите немного.',
            clientMessageId: data.clientMessageId,
          });
          return;
        }

        const clientMessageId = data.clientMessageId || `${userId}_${Date.now()}_${Math.random()}`;

        const result = await chatService.sendMessage({
          content: validation.content ?? '',
          senderId: userId,
          receiverId: data.receiverId ?? null,
          chatId: data.chatId,
          clientMessageId,
          soundTokId: data.soundTokId ?? null,
        });

        if (!result.success || !result.message) {
          const response: MessageResponse = {
            success: false,
            error: result.error || 'Failed to send message',
            clientMessageId,
          };
          callback(response);
          return;
        }

        const message = result.message;

        // Broadcast to all users in chat
        io.to(`chat:${data.chatId}`).emit('message:new', message);

        // Check if receiver is in chat for immediate delivery status
        const chatUsers = activeChatUsers.get(data.chatId);
        const receiverInChat = data.receiverId ? chatUsers?.has(data.receiverId) : false;

        if (receiverInChat) {
          // Mark as delivered immediately
          io.to(`chat:${data.chatId}`).emit('message:delivered', {
            clientMessageId,
            messageId: message.id,
          });
        }

        const response: MessageResponse = {
          success: true,
          message,
          clientMessageId,
        };
        callback(response);

        console.log(`[Socket] Message sent in chat ${data.chatId}`);
      } catch (error) {
        console.error('[Socket] Error sending message:', error);
        callback({
          success: false,
          error: 'Internal server error',
          clientMessageId: data.clientMessageId,
        });
      }
    });

    // Mark messages as read
    socket.on('message:read', async (data) => {
      try {
        const result = await chatService.markMessagesAsRead(
          data.messageIds,
          userId,
          data.chatId
        );

        if (result.count > 0) {
          for (const messageId of result.updatedIds) {
            socket.to(`chat:${data.chatId}`).emit('message:status', {
              messageId,
              status: 'READ',
              readAt: new Date(),
            });
          }
        }

        console.log(`[Socket] ${result.count} messages marked as read in chat ${data.chatId}`);
      } catch (error) {
        console.error('[Socket] Error marking messages as read:', error);
      }
    });

    // Mark single message as delivered (used when receiving)
    socket.on('message:deliver', async (data) => {
      try {
        if (!data.chatId) return;
        socket.to(`chat:${data.chatId}`).emit('message:delivered', {
          clientMessageId: '',
          messageId: data.messageId,
        });
      } catch (error) {
        console.error('[Socket] Error delivering message:', error);
      }
    });

    // Typing indicator
    socket.on('chat:typing', (data) => {
      socket.to(`chat:${data.chatId}`).emit('chat:typing', {
        chatId: data.chatId,
        userId,
        isTyping: data.isTyping,
      });
    });

    // ─────────────────────────────────────────
    // USER SUBSCRIPTION EVENTS
    // ─────────────────────────────────────────

    socket.on('user:subscribe', (targetUserId: string) => {
      socket.join(`user:${targetUserId}`);
      socket.emit('user:online', {
        userId: targetUserId,
        isOnline: userSockets.has(targetUserId),
      });
    });

    // ─────────────────────────────────────────
    // DISCONNECT HANDLING
    // ─────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] User disconnected: ${username} (${userId}), reason: ${reason}`);

      // Remove from user sockets
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        
        // If no more sockets for this user, mark as offline
        if (sockets.size === 0) {
          userSockets.delete(userId);
          
          io.to(`user:${userId}`).emit('user:online', { userId, isOnline: false });

          activeChatUsers.forEach((users, chatId) => {
            if (users.has(userId)) {
              io.to(`chat:${chatId}`).emit('chat:presence', {
                chatId,
                userId,
                isOnline: false,
              });
            }
          });
        }
      }

      // Remove from all active chats
      activeChatUsers.forEach((users, chatId) => {
        if (users.has(userId)) {
          users.delete(userId);
          if (users.size === 0) {
            activeChatUsers.delete(chatId);
          }
        }
      });
    });
  });

  return io;
}

// Helper functions for external use
export function getUserOnlineStatus(userId: string): boolean {
  return userSockets.has(userId);
}

export function getActiveChatUsers(chatId: string): string[] {
  return Array.from(activeChatUsers.get(chatId) || new Set());
}
