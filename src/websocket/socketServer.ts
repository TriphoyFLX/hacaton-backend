import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { chatService } from '../services/chatService';
import { profileService } from '../services/profileService';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  MessageResponse,
} from '../types';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

// Map of userId -> Set of socket IDs (for multiple device support)
const userSockets = new Map<string, Set<string>>();
// Map of chatId -> Set of user IDs currently in chat
const activeChatUsers = new Map<string, Set<string>>();

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

    // Broadcast online status to subscribed users
    socket.broadcast.emit('user:online', { userId, isOnline: true });

    // ─────────────────────────────────────────
    // CHAT EVENTS
    // ─────────────────────────────────────────

    // Join chat room
    socket.on('chat:join', async (chatId: string) => {
      try {
        const isMember = await chatService.createOrGetChat(userId, userId); // Verify membership
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

      console.log(`[Socket] ${username} left chat ${chatId}`);
    });

    // Send message
    socket.on('message:send', async (data, callback) => {
      try {
        // Generate client message ID if not provided
        const clientMessageId = data.clientMessageId || `${userId}_${Date.now()}_${Math.random()}`;

        const result = await chatService.sendMessage({
          content: data.content,
          senderId: userId,
          receiverId: data.receiverId,
          chatId: data.chatId,
          clientMessageId,
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
        const receiverInChat = chatUsers?.has(data.receiverId);

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
          // Notify other users about read status
          socket.to(`chat:${data.chatId}`).emit('message:status', {
            messageId: result.updatedIds[0], // Send first ID as reference
            status: 'READ',
            readAt: new Date(),
          });
        }

        console.log(`[Socket] ${result.count} messages marked as read in chat ${data.chatId}`);
      } catch (error) {
        console.error('[Socket] Error marking messages as read:', error);
      }
    });

    // Mark single message as delivered (used when receiving)
    socket.on('message:deliver', async (data) => {
      try {
        // This is mainly for acknowledgment
        socket.to(`chat:${data.messageId}`).emit('message:delivered', {
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
      
      // Send current online status
      const isOnline = userSockets.has(targetUserId);
      socket.emit('user:online', { userId: targetUserId, isOnline });
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
          
          // Broadcast offline status
          io.emit('user:online', { userId, isOnline: false });
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
