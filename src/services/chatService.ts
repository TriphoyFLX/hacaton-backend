import { messageRepository } from '../repositories/messageRepository';
import { chatRepository, ChatWithUsers } from '../repositories/chatRepository';
import { userRepository } from '../repositories/userRepository';
import { validateMessageContent } from '../utils/messageValidation';
import { MessageWithSender } from '../types';

export interface SendMessageResult {
  success: boolean;
  message?: MessageWithSender;
  error?: string;
  isDuplicate?: boolean;
}

export interface ChatInfo {
  chat: ChatWithUsers;
  messages: MessageWithSender[];
  unreadCount: number;
}

export class ChatService {
  /**
   * Send a message with deduplication check
   */
  async sendMessage(data: {
    content: string;
    senderId: string;
    receiverId: string;
    chatId: string;
    clientMessageId: string;
  }): Promise<SendMessageResult> {
    try {
      const validation = validateMessageContent(data.content);
      if (!validation.valid || !validation.content) {
        return { success: false, error: validation.error || 'Invalid message' };
      }

      const sanitizedContent = validation.content;

      // Verify sender is in chat
      const isMember = await chatRepository.isChatMember(data.chatId, data.senderId);
      if (!isMember) {
        return { success: false, error: 'Not a member of this chat' };
      }

      // Verify receiver exists and is in chat
      const receiverInChat = await chatRepository.isChatMember(data.chatId, data.receiverId);
      if (!receiverInChat) {
        return { success: false, error: 'Receiver not in chat' };
      }

      // Create message (handles deduplication internally)
      const message = await messageRepository.createMessage({
        content: sanitizedContent,
        senderId: data.senderId,
        receiverId: data.receiverId,
        chatId: data.chatId,
        clientMessageId: data.clientMessageId,
      });

      if (!message) {
        return { success: false, error: 'Failed to create message' };
      }

      // Update chat timestamp
      await chatRepository.updateTimestamp(data.chatId);

      return {
        success: true,
        message,
      };
    } catch (error) {
      console.error('ChatService.sendMessage error:', error);
      return { success: false, error: 'Internal server error' };
    }
  }

  /**
   * Get chat history with messages
   */
  async getChatHistory(
    chatId: string,
    userId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<ChatInfo | null> {
    // Verify user is in chat
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) {
      return null;
    }

    const [chat, messages, unreadCount] = await Promise.all([
      chatRepository.getChatById(chatId),
      messageRepository.getMessagesByChatId(chatId, {
        ...options,
        limit: options.limit || 50,
      }),
      messageRepository.getUnreadCount(chatId, userId),
    ]);

    if (!chat) {
      return null;
    }

    return {
      chat,
      messages,
      unreadCount,
    };
  }

  /**
   * Get all chats for user
   */
  async getUserChats(userId: string): Promise<ChatWithUsers[]> {
    return chatRepository.getChatsByUserId(userId);
  }

  /**
   * Create or get existing chat
   */
  async createOrGetChat(userId1: string, userId2: string): Promise<ChatWithUsers | null> {
    // Verify both users exist
    const [user1, user2] = await Promise.all([
      userRepository.getUserById(userId1),
      userRepository.getUserById(userId2),
    ]);

    if (!user1 || !user2) {
      return null;
    }

    if (userId1 === userId2) {
      return null;
    }

    return chatRepository.createChat(userId1, userId2);
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(
    messageIds: string[],
    userId: string,
    chatId: string
  ): Promise<{ count: number; updatedIds: string[] }> {
    // Verify user is in chat
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) {
      return { count: 0, updatedIds: [] };
    }

    // Verify messages belong to this chat and user is receiver
    const validMessageIds = await this.validateMessageIds(messageIds, chatId, userId);
    
    if (validMessageIds.length === 0) {
      return { count: 0, updatedIds: [] };
    }

    const count = await messageRepository.markAsRead(validMessageIds, userId);

    return {
      count,
      updatedIds: validMessageIds,
    };
  }

  /**
   * Mark messages as delivered when user opens chat
   */
  async markChatAsDelivered(chatId: string, userId: string): Promise<string[]> {
    const messages = await messageRepository.markAsDelivered(chatId, userId);
    return messages.map(m => m.id);
  }

  /**
   * Get unread counts for all chats
   */
  async getUnreadCounts(userId: string, chatIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    await Promise.all(
      chatIds.map(async (chatId) => {
        const count = await messageRepository.getUnreadCount(chatId, userId);
        counts.set(chatId, count);
      })
    );

    return counts;
  }

  /**
   * Validate that messages belong to chat and user is receiver
   */
  private async validateMessageIds(
    messageIds: string[],
    chatId: string,
    userId: string
  ): Promise<string[]> {
    const messages = await messageRepository.getMessagesByChatId(chatId);
    
    const validIds = new Set(
      messages
        .filter(m => m.receiverId === userId && messageIds.includes(m.id))
        .map(m => m.id)
    );

    return messageIds.filter(id => validIds.has(id));
  }
}

export const chatService = new ChatService();
