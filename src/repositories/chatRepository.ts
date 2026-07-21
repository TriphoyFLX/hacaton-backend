import { PrismaClient, ChatType } from '@prisma/client';

const prisma = new PrismaClient();

const chatUserInclude = {
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
} as const;

const chatListInclude = {
  users: chatUserInclude,
        messages: {
          orderBy: { createdAt: 'desc' as const },
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
          },
        },
};

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

function isExactDirectPair(
  chat: { type: ChatType; users: { userId: string }[] },
  userId1: string,
  userId2: string
): boolean {
  if (chat.type === ChatType.GROUP) return false;
  if (chat.users.length !== 2) return false;
  const ids = new Set(chat.users.map((u) => u.userId));
  return ids.has(userId1) && ids.has(userId2);
}

function peerKeyForDirect(chat: ChatWithUsers, currentUserId: string): string | null {
  if (chat.type === ChatType.GROUP) return null;
  if (chat.users.length !== 2) return null;
  const other = chat.users.find((u) => u.userId !== currentUserId);
  return other?.userId ?? null;
}

function scoreDirectChat(chat: ChatWithUsers, userId: string): number {
  const membership = chat.users.find((u) => u.userId === userId);
  const hasMessages = (chat.messages?.length || 0) > 0 ? 1_000_000_000 : 0;
  const pinned = membership?.pinnedAt ? membership.pinnedAt.getTime() : 0;
  const updated = chat.updatedAt.getTime();
  // Prefer chats with messages, then pinned, then most recently updated
  return hasMessages + pinned + updated;
}

export class ChatRepository {
  async getChatsByUserId(userId: string): Promise<ChatWithUsers[]> {
    // Merge any duplicate 1-1 chats before returning the list
    await this.mergeAllDuplicateDirectChatsForUser(userId);

    const chats = await prisma.chat.findMany({
      where: {
        users: { some: { userId } },
      },
      include: chatListInclude,
    });

    const typed = chats as ChatWithUsers[];
    const unique: ChatWithUsers[] = [];
    const seenPeers = new Set<string>();

    // Safety dedupe in memory if any leftovers remain
    for (const chat of typed) {
      const peer = peerKeyForDirect(chat, userId);
      if (peer) {
        if (seenPeers.has(peer)) continue;
        seenPeers.add(peer);
      }
      unique.push(chat);
    }

    return unique.sort((a, b) => {
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
        users: chatUserInclude,
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

  async usersShareChat(userId: string, otherUserId: string): Promise<boolean> {
    const chat = await prisma.chat.findFirst({
      where: {
        AND: [
          { users: { some: { userId } } },
          { users: { some: { userId: otherUserId } } },
        ],
      },
      select: { id: true },
    });
    return !!chat;
  }

  /**
   * Find all DIRECT chats that are exactly between these two users.
   */
  async findDirectChatsBetween(userId1: string, userId2: string): Promise<ChatWithUsers[]> {
    const chats = await prisma.chat.findMany({
      where: {
        type: ChatType.DIRECT,
        AND: [
          { users: { some: { userId: userId1 } } },
          { users: { some: { userId: userId2 } } },
        ],
      },
      include: chatListInclude,
    });

    return (chats as ChatWithUsers[]).filter((chat) =>
      isExactDirectPair(chat, userId1, userId2)
    );
  }

  /**
   * Merge duplicate 1-1 chats into one primary chat.
   * Moves messages, keeps pin/read state, deletes extras.
   */
  async mergeDirectChatDuplicates(
    duplicates: ChatWithUsers[],
    preferUserId: string
  ): Promise<ChatWithUsers> {
    if (duplicates.length === 0) {
      throw new Error('No chats to merge');
    }
    if (duplicates.length === 1) {
      return duplicates[0];
    }

    const sorted = [...duplicates].sort(
      (a, b) => scoreDirectChat(b, preferUserId) - scoreDirectChat(a, preferUserId)
    );
    const primary = sorted[0];
    const extras = sorted.slice(1);

    for (const extra of extras) {
      await prisma.$transaction(async (tx) => {
        // Move messages into primary (handle rare clientMessageId collisions)
        const messages = await tx.message.findMany({
          where: { chatId: extra.id },
          select: { id: true, clientMessageId: true },
        });

        for (const message of messages) {
          try {
            await tx.message.update({
              where: { id: message.id },
              data: { chatId: primary.id },
            });
          } catch {
            // Unique (clientMessageId, chatId) collision — drop the duplicate message
            await tx.message.delete({ where: { id: message.id } });
          }
        }

        // Preserve pin / lastRead for both members if primary missing them
        for (const membership of extra.users) {
          const primaryMembership = await tx.chatUser.findUnique({
            where: {
              userId_chatId: { userId: membership.userId, chatId: primary.id },
            },
          });

          if (!primaryMembership) continue;

          await tx.chatUser.update({
            where: { id: primaryMembership.id },
            data: {
              pinnedAt: primaryMembership.pinnedAt ?? membership.pinnedAt ?? null,
              lastReadAt:
                primaryMembership.lastReadAt && membership.lastReadAt
                  ? primaryMembership.lastReadAt > membership.lastReadAt
                    ? primaryMembership.lastReadAt
                    : membership.lastReadAt
                  : primaryMembership.lastReadAt ?? membership.lastReadAt ?? null,
            },
          });
        }

        await tx.chat.delete({ where: { id: extra.id } });
      });
    }

    await prisma.chat.update({
      where: { id: primary.id },
      data: { updatedAt: new Date() },
    });

    const refreshed = await prisma.chat.findUnique({
      where: { id: primary.id },
      include: chatListInclude,
    });

    return refreshed as ChatWithUsers;
  }

  async mergeAllDuplicateDirectChatsForUser(userId: string): Promise<void> {
    const chats = await prisma.chat.findMany({
      where: {
        type: ChatType.DIRECT,
        users: { some: { userId } },
      },
      include: chatListInclude,
    });

    const byPeer = new Map<string, ChatWithUsers[]>();

    for (const chat of chats as ChatWithUsers[]) {
      const peer = peerKeyForDirect(chat, userId);
      if (!peer) continue;
      const list = byPeer.get(peer) || [];
      list.push(chat);
      byPeer.set(peer, list);
    }

    for (const [, group] of byPeer) {
      if (group.length > 1) {
        await this.mergeDirectChatDuplicates(group, userId);
      }
    }
  }

  async createChat(userId1: string, userId2: string): Promise<ChatWithUsers> {
    const existing = await this.findDirectChatsBetween(userId1, userId2);

    if (existing.length === 1) {
      return existing[0];
    }

    if (existing.length > 1) {
      return this.mergeDirectChatDuplicates(existing, userId1);
    }

    try {
      const chat = await prisma.chat.create({
        data: {
          type: ChatType.DIRECT,
          users: {
            create: [{ userId: userId1 }, { userId: userId2 }],
          },
        },
        include: chatListInclude,
      });

      return chat as ChatWithUsers;
    } catch {
      // Race: another request created the chat — reuse it
      const raced = await this.findDirectChatsBetween(userId1, userId2);
      if (raced.length > 0) {
        return raced.length === 1
          ? raced[0]
          : this.mergeDirectChatDuplicates(raced, userId1);
      }
      throw new Error('Failed to create chat');
    }
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
        users: chatUserInclude,
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
