import { PrismaClient, Message, MessageStatus, Prisma } from '@prisma/client';
import { MessageWithSender } from '../types';

const prisma = new PrismaClient();

const messageInclude = {
  sender: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
    },
  },
  soundTok: {
    select: {
      id: true,
      description: true,
      videoUrl: true,
      authorId: true,
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      },
    },
  },
} as const;

export class MessageRepository {
  /**
   * Create a new message with deduplication check
   */
  async createMessage(data: {
    content: string;
    senderId: string;
    receiverId?: string | null;
    chatId: string;
    clientMessageId?: string;
    soundTokId?: string | null;
  }): Promise<MessageWithSender | null> {
    // Check for duplicate message
    if (data.clientMessageId) {
      const existing = await prisma.message.findFirst({
        where: {
          clientMessageId: data.clientMessageId,
          chatId: data.chatId,
        },
        include: messageInclude,
      });

      if (existing) {
        return existing as MessageWithSender;
      }
    }

    return prisma.message.create({
      data: {
        content: data.content,
        senderId: data.senderId,
        receiverId: data.receiverId,
        chatId: data.chatId,
        clientMessageId: data.clientMessageId,
        soundTokId: data.soundTokId || null,
        status: MessageStatus.SENT,
      },
      include: messageInclude,
    }) as Promise<MessageWithSender>;
  }

  /**
   * Get messages for a chat with pagination
   */
  async getMessagesByChatId(
    chatId: string,
    options: {
      cursor?: string;
      limit?: number;
      before?: Date;
    } = {}
  ): Promise<MessageWithSender[]> {
    const { cursor, limit = 50, before } = options;

    const where: Prisma.MessageWhereInput = { chatId };
    
    if (before) {
      where.createdAt = { lt: before };
    }

    return prisma.message.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'asc' },
      include: messageInclude,
    }) as Promise<MessageWithSender[]>;
  }

  /**
   * Update message status
   */
  async updateStatus(
    messageId: string,
    status: MessageStatus,
    readAt?: Date
  ): Promise<Message | null> {
    return prisma.message.update({
      where: { id: messageId },
      data: {
        status,
        readAt: status === MessageStatus.READ ? readAt || new Date() : undefined,
      },
    });
  }

  /**
   * Mark multiple messages as read
   */
  async markAsRead(messageIds: string[], receiverId: string): Promise<number> {
    const result = await prisma.message.updateMany({
      where: {
        id: { in: messageIds },
        receiverId,
        status: { not: MessageStatus.READ },
      },
      data: {
        status: MessageStatus.READ,
        readAt: new Date(),
      },
    });

    return result.count;
  }

  /**
   * Mark messages as delivered for a user in a chat
   */
  async markAsDelivered(chatId: string, receiverId: string): Promise<Message[]> {
    const messages = await prisma.message.findMany({
      where: {
        chatId,
        receiverId,
        status: MessageStatus.SENT,
      },
    });

    if (messages.length === 0) return [];

    await prisma.message.updateMany({
      where: {
        id: { in: messages.map(m => m.id) },
      },
      data: {
        status: MessageStatus.DELIVERED,
      },
    });

    return messages;
  }

  /**
   * Get unread message count for a user in a chat
   */
  async getUnreadCount(chatId: string, userId: string): Promise<number> {
    const chatUser = await prisma.chatUser.findUnique({
      where: { userId_chatId: { userId, chatId } },
      select: { lastReadAt: true },
    });

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { type: true },
    });

    if (chat?.type === 'GROUP') {
      return prisma.message.count({
        where: {
          chatId,
          senderId: { not: userId },
          createdAt: { gt: chatUser?.lastReadAt ?? new Date(0) },
        },
      });
    }

    return prisma.message.count({
      where: {
        chatId,
        receiverId: userId,
        status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
      },
    });
  }

  /**
   * Get last message for each chat
   */
  async getLastMessagesForChats(chatIds: string[]): Promise<Map<string, MessageWithSender>> {
    const messages = await prisma.message.findMany({
      where: {
        chatId: { in: chatIds },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['chatId'],
      include: messageInclude,
    });

    const result = new Map<string, MessageWithSender>();
    for (const msg of messages) {
      result.set(msg.chatId, msg as MessageWithSender);
    }

    return result;
  }
}

export const messageRepository = new MessageRepository();
