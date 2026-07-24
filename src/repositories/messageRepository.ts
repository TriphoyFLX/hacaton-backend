import { Message, MessageStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { MessageWithSender } from '../types';


const ALLOWED_REACTION_EMOJIS = ['❤️', '👍', '😂', '🔥', '😮', '😢'] as const;

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
  replyTo: {
    select: {
      id: true,
      content: true,
      senderId: true,
      deletedAt: true,
      soundTokId: true,
      sender: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
    },
  },
  reactions: {
    select: {
      id: true,
      emoji: true,
      userId: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

function sanitizeMessage(message: MessageWithSender): MessageWithSender {
  let result = message;
  if (message.deletedAt) {
    result = {
      ...message,
      content: '',
      soundTokId: null,
      soundTok: null,
      imageUrl: null,
    };
  }
  if (result.replyTo?.deletedAt) {
    result = {
      ...result,
      replyTo: {
        ...result.replyTo,
        content: '',
        soundTokId: null,
      },
    };
  }
  return result;
}

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
    replyToId?: string | null;
    imageUrl?: string | null;
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
        return sanitizeMessage(existing as MessageWithSender);
      }
    }

    const created = await prisma.message.create({
      data: {
        content: data.content,
        senderId: data.senderId,
        receiverId: data.receiverId,
        chatId: data.chatId,
        clientMessageId: data.clientMessageId,
        soundTokId: data.soundTokId || null,
        replyToId: data.replyToId || null,
        imageUrl: data.imageUrl || null,
        status: MessageStatus.SENT,
      },
      include: messageInclude,
    });
    return sanitizeMessage(created as MessageWithSender);
  }

  /**
   * Get messages for a chat with pagination (newest page by default).
   * Returns chronological order (oldest → newest) for UI rendering.
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

    const rows = await prisma.message.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      // Newest first, then reverse so the UI gets oldest→newest for a page
      orderBy: { createdAt: 'desc' },
      include: messageInclude,
    });

    return rows
      .reverse()
      .map((message) => sanitizeMessage(message as MessageWithSender));
  }

  async softDeleteMessage(messageId: string, senderId: string, chatId: string): Promise<MessageWithSender | null> {
    const existing = await prisma.message.findFirst({
      where: { id: messageId, chatId, senderId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return null;

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '', soundTokId: null, imageUrl: null, editedAt: null },
      include: messageInclude,
    });
    return sanitizeMessage(updated as MessageWithSender);
  }

  async editMessage(
    messageId: string,
    senderId: string,
    chatId: string,
    content: string,
  ): Promise<MessageWithSender | null> {
    const existing = await prisma.message.findFirst({
      where: { id: messageId, chatId, senderId, deletedAt: null },
      select: { id: true, soundTokId: true, imageUrl: true },
    });
    if (!existing) return null;
    if (!content && !existing.soundTokId && !existing.imageUrl) return null;

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        editedAt: new Date(),
      },
      include: messageInclude,
    });
    return sanitizeMessage(updated as MessageWithSender);
  }

  async toggleReaction(input: {
    messageId: string;
    chatId: string;
    userId: string;
    emoji: string;
  }): Promise<{ message: MessageWithSender; added: boolean } | null> {
    if (!ALLOWED_REACTION_EMOJIS.includes(input.emoji as typeof ALLOWED_REACTION_EMOJIS[number])) {
      return null;
    }

    const message = await prisma.message.findFirst({
      where: { id: input.messageId, chatId: input.chatId, deletedAt: null },
      select: { id: true },
    });
    if (!message) return null;

    const existing = await prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId: input.messageId,
          userId: input.userId,
          emoji: input.emoji,
        },
      },
    });

    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.messageReaction.create({
        data: {
          messageId: input.messageId,
          userId: input.userId,
          emoji: input.emoji,
        },
      });
    }

    const updated = await prisma.message.findUnique({
      where: { id: input.messageId },
      include: messageInclude,
    });
    if (!updated) return null;
    return {
      message: sanitizeMessage(updated as MessageWithSender),
      added: !existing,
    };
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

  async getReadableMessageIds(messageIds: string[], chatId: string, receiverId: string): Promise<string[]> {
    const messages = await prisma.message.findMany({
      where: {
        id: { in: messageIds },
        chatId,
        receiverId,
      },
      select: { id: true },
    });
    return messages.map((message) => message.id);
  }

  async getMessageForDelivery(messageId: string, chatId: string) {
    return prisma.message.findFirst({
      where: { id: messageId, chatId },
      select: { id: true, receiverId: true },
    });
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
          deletedAt: null,
          createdAt: { gt: chatUser?.lastReadAt ?? new Date(0) },
        },
      });
    }

    return prisma.message.count({
      where: {
        chatId,
        receiverId: userId,
        deletedAt: null,
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
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['chatId'],
      include: messageInclude,
    });

    const result = new Map<string, MessageWithSender>();
    for (const msg of messages) {
      result.set(msg.chatId, sanitizeMessage(msg as MessageWithSender));
    }

    return result;
  }
}

export const messageRepository = new MessageRepository();
export { ALLOWED_REACTION_EMOJIS };
