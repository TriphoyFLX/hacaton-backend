import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface ChatWithUsers {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  users: {
    id: string;
    userId: string;
    chatId: string;
    createdAt: Date;
    user: {
      id: string;
      username: string;
      displayName?: string | null;
      avatar?: string | null;
      lastSeen?: Date | null;
    };
  }[];
}

export class ChatRepository {
  /**
   * Get all chats for a user with last message
   */
  async getChatsByUserId(userId: string): Promise<ChatWithUsers[]> {
    const chats = await prisma.chat.findMany({
      where: {
        users: {
          some: {
            userId,
          },
        },
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return chats as ChatWithUsers[];
  }

  /**
   * Get single chat by ID with users
   */
  async getChatById(chatId: string): Promise<ChatWithUsers | null> {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    return chat as ChatWithUsers | null;
  }

  /**
   * Check if user is member of chat
   */
  async isChatMember(chatId: string, userId: string): Promise<boolean> {
    const chatUser = await prisma.chatUser.findFirst({
      where: {
        chatId,
        userId,
      },
    });

    return !!chatUser;
  }

  /**
   * Create a new chat between two users
   */
  async createChat(userId1: string, userId2: string): Promise<ChatWithUsers> {
    // Check for existing chat
    const existingChat = await prisma.chat.findFirst({
      where: {
        AND: [
          { users: { some: { userId: userId1 } } },
          { users: { some: { userId: userId2 } } },
        ],
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (existingChat && existingChat.users.length === 2) {
      return existingChat as ChatWithUsers;
    }

    // Create new chat
    const chat = await prisma.chat.create({
      data: {
        users: {
          create: [{ userId: userId1 }, { userId: userId2 }],
        },
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    return chat as ChatWithUsers;
  }

  /**
   * Update chat timestamp
   */
  async updateTimestamp(chatId: string): Promise<void> {
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });
  }

  /**
   * Get chat participants (userIds only)
   */
  async getChatParticipants(chatId: string): Promise<string[]> {
    const chatUsers = await prisma.chatUser.findMany({
      where: { chatId },
      select: { userId: true },
    });

    return chatUsers.map(cu => cu.userId);
  }

  /**
   * Get other participant in a 1-on-1 chat
   */
  async getOtherParticipant(chatId: string, userId: string): Promise<string | null> {
    const otherUser = await prisma.chatUser.findFirst({
      where: {
        chatId,
        userId: { not: userId },
      },
      select: { userId: true },
    });

    return otherUser?.userId || null;
  }
}

export const chatRepository = new ChatRepository();
