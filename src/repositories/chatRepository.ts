import { PrismaClient, ChatType } from '@prisma/client';

const prisma = new PrismaClient();

export interface ChatWithUsers {
  id: string;
  type: ChatType;
  name?: string | null;
  creatorId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  users: {
    id: string;
    userId: string;
    chatId: string;
    pinnedAt?: Date | null;
    lastReadAt?: Date | null;
    createdAt: Date;
    user: {
      id: string;
      username: string;
      displayName?: string | null;
      avatar?: string | null;
    };
  }[];
  messages?: any[];
}

export class ChatRepository {
  async getChatsByUserId(userId: string): Promise<ChatWithUsers[]> {
    const chats = await prisma.chat.findMany({
      where: {
        users: { some: { userId } },
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
    });

    return (chats as ChatWithUsers[]).sort((a, b) => {
      const aPinned = a.users.find((u) => u.userId === userId)?.pinnedAt;
      const bPinned = b.users.find((u) => u.userId === userId)?.pinnedAt;

      if (aPinned && bPinned) {
        return bPinned.getTime() - aPinned.getTime();
      }
      if (aPinned) return -1;
      if (bPinned) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

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

  async getChatMeta(chatId: string) {
    return prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, type: true, name: true, creatorId: true },
    });
  }

  async isChatMember(chatId: string, userId: string): Promise<boolean> {
    const chatUser = await prisma.chatUser.findFirst({
      where: { chatId, userId },
    });
    return !!chatUser;
  }

  async createChat(userId1: string, userId2: string): Promise<ChatWithUsers> {
    const existingChat = await prisma.chat.findFirst({
      where: {
        type: ChatType.DIRECT,
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

    const chat = await prisma.chat.create({
      data: {
        type: ChatType.DIRECT,
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

  async createGroupChat(
    creatorId: string,
    name: string,
    memberIds: string[]
  ): Promise<ChatWithUsers> {
    const uniqueMembers = [...new Set([creatorId, ...memberIds])];

    const chat = await prisma.chat.create({
      data: {
        type: ChatType.GROUP,
        name: name.trim(),
        creatorId,
        users: {
          create: uniqueMembers.map((userId) => ({ userId })),
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

  async setChatPinned(chatId: string, userId: string, pinned: boolean): Promise<Date | null> {
    const updated = await prisma.chatUser.update({
      where: {
        userId_chatId: { userId, chatId },
      },
      data: {
        pinnedAt: pinned ? new Date() : null,
      },
      select: {
        pinnedAt: true,
      },
    });

    return updated.pinnedAt;
  }

  async updateLastReadAt(chatId: string, userId: string): Promise<void> {
    await prisma.chatUser.update({
      where: {
        userId_chatId: { userId, chatId },
      },
      data: {
        lastReadAt: new Date(),
      },
    });
  }

  async updateTimestamp(chatId: string): Promise<void> {
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });
  }

  async getChatParticipants(chatId: string): Promise<string[]> {
    const chatUsers = await prisma.chatUser.findMany({
      where: { chatId },
      select: { userId: true },
    });
    return chatUsers.map((cu) => cu.userId);
  }

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
