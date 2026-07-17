import { ChatType, PrismaClient } from '@prisma/client';
import { messageRepository } from '../repositories/messageRepository';
import { MessageWithSender } from '../types';

const prisma = new PrismaClient();

export interface SendMessageResult {
  success: boolean;
  message?: MessageWithSender;
  error?: string;
}

export interface ChatInfo {
  chat: ChatWithUsers;
  messages: MessageWithSender[];
  unreadCount: number;
}

export class ChatService {
  async sendMessage(data: {
    content: string;
    senderId: string;
    receiverId?: string | null;
    chatId: string;
    clientMessageId: string;
    soundTokId?: string | null;
  }): Promise<SendMessageResult> {
    try {
      const hasSoundTok = !!data.soundTokId;
      const validation = validateMessageContent(data.content, {
        allowEmpty: hasSoundTok,
      });
      if (!validation.valid || validation.content === undefined) {
        return { success: false, error: validation.error || 'Invalid message' };
      }

      if (!hasSoundTok && !validation.content) {
        return { success: false, error: 'Сообщение не может быть пустым' };
      }

      let soundTokId: string | null = null;
      if (data.soundTokId) {
        const soundTok = await prisma.soundTok.findUnique({
          where: { id: data.soundTokId },
          select: { id: true },
        });
        if (!soundTok) {
          return { success: false, error: 'Видео не найдено' };
        }
        soundTokId = soundTok.id;
      }

      const chatMeta = await chatRepository.getChatMeta(data.chatId);
      if (!chatMeta) {
        return { success: false, error: 'Chat not found' };
      }

      const isMember = await chatRepository.isChatMember(data.chatId, data.senderId);
      if (!isMember) {
        return { success: false, error: 'Not a member of this chat' };
      }

      let receiverId: string | null = data.receiverId ?? null;

      if (chatMeta.type === ChatType.DIRECT) {
        if (!receiverId) {
          receiverId = await chatRepository.getOtherParticipant(data.chatId, data.senderId);
        }
        if (!receiverId) {
          return { success: false, error: 'Receiver not in chat' };
        }

        const isBlocked = await blockRepository.isEitherBlocked(data.senderId, receiverId);
        if (isBlocked) {
          return { success: false, error: 'Невозможно отправить сообщение этому пользователю' };
        }

        const receiverInChat = await chatRepository.isChatMember(data.chatId, receiverId);
        if (!receiverInChat) {
          return { success: false, error: 'Receiver not in chat' };
        }
      } else {
        receiverId = null;
      }

      const message = await messageRepository.createMessage({
        content: validation.content,
        senderId: data.senderId,
        receiverId,
        chatId: data.chatId,
        clientMessageId: data.clientMessageId,
        soundTokId,
      });

      if (!message) {
        return { success: false, error: 'Failed to create message' };
      }

      await chatRepository.updateTimestamp(data.chatId);

      return { success: true, message };
    } catch (error) {
      console.error('ChatService.sendMessage error:', error);
      return { success: false, error: 'Internal server error' };
    }
  }

  async getChatHistory(
    chatId: string,
    userId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<ChatInfo | null> {
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) return null;

    const [chat, messages, unreadCount] = await Promise.all([
      chatRepository.getChatById(chatId),
      messageRepository.getMessagesByChatId(chatId, {
        ...options,
        limit: options.limit || 50,
      }),
      messageRepository.getUnreadCount(chatId, userId),
    ]);

    if (!chat) return null;

    return { chat, messages, unreadCount };
  }

  async getUserChats(userId: string): Promise<ChatWithUsers[]> {
    return chatRepository.getChatsByUserId(userId);
  }

  async createOrGetChat(userId1: string, userId2: string): Promise<ChatWithUsers | null> {
    const [user1, user2] = await Promise.all([
      userRepository.getUserById(userId1),
      userRepository.getUserById(userId2),
    ]);

    if (!user1 || !user2 || userId1 === userId2) return null;

    const isBlocked = await blockRepository.isEitherBlocked(userId1, userId2);
    if (isBlocked) return null;

    return chatRepository.createChat(userId1, userId2);
  }

  async createGroup(
    creatorId: string,
    name: string,
    memberIds: string[]
  ): Promise<{ success: boolean; chat?: ChatWithUsers; error?: string }> {
    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length < 2) {
      return { success: false, error: 'Название группы должно быть минимум 2 символа' };
    }

    const uniqueMembers = [...new Set(memberIds.filter((id) => id !== creatorId))];
    if (uniqueMembers.length < 1) {
      return { success: false, error: 'Добавьте хотя бы одного участника' };
    }

    for (const memberId of uniqueMembers) {
      const user = await userRepository.getUserById(memberId);
      if (!user) {
        return { success: false, error: 'Один из участников не найден' };
      }
      const blocked = await blockRepository.isEitherBlocked(creatorId, memberId);
      if (blocked) {
        return { success: false, error: 'Нельзя добавить заблокированного пользователя' };
      }
    }

    const chat = await chatRepository.createGroupChat(creatorId, trimmedName, uniqueMembers);
    return { success: true, chat };
  }

  async togglePin(
    chatId: string,
    userId: string,
    pinned: boolean
  ): Promise<{ success: boolean; pinnedAt: Date | null }> {
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) {
      return { success: false, pinnedAt: null };
    }

    const pinnedAt = await chatRepository.setChatPinned(chatId, userId, pinned);
    return { success: true, pinnedAt };
  }

  async markMessagesAsRead(
    messageIds: string[],
    userId: string,
    chatId: string
  ): Promise<{ count: number; updatedIds: string[] }> {
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) {
      return { count: 0, updatedIds: [] };
    }

    await chatRepository.updateLastReadAt(chatId, userId);

    const chatMeta = await chatRepository.getChatMeta(chatId);
    if (chatMeta?.type === ChatType.GROUP) {
      return { count: 1, updatedIds: messageIds };
    }

    const validMessageIds = await this.validateMessageIds(messageIds, chatId, userId);
    if (validMessageIds.length === 0) {
      return { count: 0, updatedIds: [] };
    }

    const count = await messageRepository.markAsRead(validMessageIds, userId);
    return { count, updatedIds: validMessageIds };
  }

  async markChatAsDelivered(chatId: string, userId: string): Promise<string[]> {
    const messages = await messageRepository.markAsDelivered(chatId, userId);
    return messages.map((m) => m.id);
  }

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

  private async validateMessageIds(
    messageIds: string[],
    chatId: string,
    userId: string
  ): Promise<string[]> {
    const messages = await messageRepository.getMessagesByChatId(chatId);
    const validIds = new Set(
      messages
        .filter((m) => m.receiverId === userId && messageIds.includes(m.id))
        .map((m) => m.id)
    );
    return messageIds.filter((id) => validIds.has(id));
  }
}

export const chatService = new ChatService();
