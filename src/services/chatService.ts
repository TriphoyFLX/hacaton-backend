import { ChatType, ChatMemberRole, MessageStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { messageRepository } from '../repositories/messageRepository';
import { MessageWithSender } from '../types';
import { chatRepository, ChatWithUsers } from '../repositories/chatRepository';
import { userRepository } from '../repositories/userRepository';
import { blockRepository } from '../repositories/blockRepository';
import { validateMessageContent } from '../utils/messageValidation';

const MAX_GROUP_MEMBERS = 100;
const MAX_GROUP_NAME_LENGTH = 120;
const CHAT_IMAGE_PATH_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;

/** Must match multer destination from index.ts (`__dirname/uploads`). */
let configuredUploadsDir = path.join(process.cwd(), 'uploads');

export function configureChatUploadsDir(dir: string): void {
  configuredUploadsDir = dir;
}

function normalizeChatImagePath(imageUrl: string): string | null {
  let value = imageUrl.trim();
  try {
    if (/^https?:\/\//i.test(value)) {
      value = new URL(value).pathname;
    }
  } catch {
    return null;
  }
  value = value.split('?')[0].split('#')[0];
  if (!CHAT_IMAGE_PATH_RE.test(value)) return null;
  return value;
}

function resolveUploadsFile(imageUrl: string, uploadsDir?: string): string | null {
  const normalized = normalizeChatImagePath(imageUrl);
  if (!normalized) return null;

  const name = path.basename(normalized);
  const candidates = [
    uploadsDir,
    configuredUploadsDir,
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), 'dist', 'uploads'),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidates) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

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
    replyToId?: string | null;
    imageUrl?: string | null;
    uploadsDir?: string;
  }): Promise<SendMessageResult> {
    try {
      const hasSoundTok = !!data.soundTokId;
      const hasImage = !!data.imageUrl;
      const validation = validateMessageContent(data.content, {
        allowEmpty: hasSoundTok || hasImage,
      });
      if (!validation.valid || validation.content === undefined) {
        return { success: false, error: validation.error || 'Invalid message' };
      }

      if (!hasSoundTok && !hasImage && !validation.content) {
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

      let replyToId: string | null = null;
      if (data.replyToId) {
        const replyTarget = await prisma.message.findFirst({
          where: { id: data.replyToId, chatId: data.chatId },
          select: { id: true },
        });
        if (!replyTarget) {
          return { success: false, error: 'Сообщение для ответа не найдено' };
        }
        replyToId = replyTarget.id;
      }

      let imageUrl: string | null = null;
      if (data.imageUrl) {
        const normalized = normalizeChatImagePath(data.imageUrl);
        if (!normalized || !resolveUploadsFile(normalized, data.uploadsDir)) {
          return { success: false, error: 'Изображение не найдено' };
        }
        imageUrl = normalized;
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
        replyToId,
        imageUrl,
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

  async getUserChats(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    return chatRepository.getChatsByUserId(userId, options);
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
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > MAX_GROUP_NAME_LENGTH) {
      return { success: false, error: `Название группы должно быть от 2 до ${MAX_GROUP_NAME_LENGTH} символов` };
    }

    const uniqueMembers = [...new Set(memberIds.filter((id) => typeof id === 'string' && id !== creatorId))];
    if (uniqueMembers.length < 1) {
      return { success: false, error: 'Добавьте хотя бы одного участника' };
    }
    if (uniqueMembers.length > MAX_GROUP_MEMBERS - 1) {
      return { success: false, error: `В группе может быть не больше ${MAX_GROUP_MEMBERS} участников` };
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
    if (messageIds.length === 0 || messageIds.length > 100) {
      return { count: 0, updatedIds: [] };
    }
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

  async deleteMessage(chatId: string, messageId: string, userId: string) {
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) return { success: false as const, error: 'Access denied' };

    const message = await messageRepository.softDeleteMessage(messageId, userId, chatId);
    if (!message) return { success: false as const, error: 'Message not found' };
    return { success: true as const, message };
  }

  async editMessage(chatId: string, messageId: string, userId: string, rawContent: unknown) {
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) return { success: false as const, error: 'Access denied' };

    const validation = validateMessageContent(rawContent, { allowEmpty: true });
    if (!validation.valid || validation.content === undefined) {
      return { success: false as const, error: validation.error || 'Invalid message' };
    }

    const message = await messageRepository.editMessage(
      messageId,
      userId,
      chatId,
      validation.content,
    );
    if (!message) {
      return { success: false as const, error: 'Message not found or empty' };
    }

    await chatRepository.updateTimestamp(chatId);
    return { success: true as const, message };
  }

  async toggleReaction(chatId: string, messageId: string, userId: string, emoji: string) {
    const isMember = await chatRepository.isChatMember(chatId, userId);
    if (!isMember) return { success: false as const, error: 'Access denied' };

    const result = await messageRepository.toggleReaction({
      messageId,
      chatId,
      userId,
      emoji,
    });
    if (!result) return { success: false as const, error: 'Invalid reaction' };
    return { success: true as const, ...result };
  }

  async getUnreadCounts(userId: string, chatIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (chatIds.length === 0) return counts;

    const memberships = await prisma.chatUser.findMany({
      where: { userId, chatId: { in: chatIds } },
      select: {
        chatId: true,
        lastReadAt: true,
        chat: { select: { type: true } },
      },
    });

    const directIds: string[] = [];
    const groupMeta: Array<{ chatId: string; lastReadAt: Date | null }> = [];
    for (const row of memberships) {
      if (row.chat.type === 'GROUP') {
        groupMeta.push({ chatId: row.chatId, lastReadAt: row.lastReadAt ?? null });
      } else {
        directIds.push(row.chatId);
      }
    }

    if (directIds.length > 0) {
      const directCounts = await prisma.message.groupBy({
        by: ['chatId'],
        where: {
          chatId: { in: directIds },
          receiverId: userId,
          deletedAt: null,
          status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
        },
        _count: { _all: true },
      });
      for (const row of directCounts) {
        counts.set(row.chatId, row._count._all);
      }
    }

    if (groupMeta.length > 0) {
      await Promise.all(
        groupMeta.map(async ({ chatId, lastReadAt }) => {
          const count = await prisma.message.count({
            where: {
              chatId,
              senderId: { not: userId },
              deletedAt: null,
              createdAt: { gt: lastReadAt ?? new Date(0) },
            },
          });
          counts.set(chatId, count);
        }),
      );
    }

    return counts;
  }

  async updateGroupAvatar(
    chatId: string,
    userId: string,
    avatar: string | null
  ): Promise<{ success: boolean; chat?: ChatWithUsers; error?: string }> {
    const meta = await chatRepository.getChatMeta(chatId);
    if (!meta || meta.type !== ChatType.GROUP) {
      return { success: false, error: 'Группа не найдена' };
    }
    const isAdmin = await chatRepository.isGroupAdmin(chatId, userId);
    if (!isAdmin) {
      return { success: false, error: 'Только админ может менять фото группы' };
    }
    let nextAvatar = avatar;
    if (avatar !== null) {
      const normalized = normalizeChatImagePath(avatar);
      if (!normalized) {
        return { success: false, error: 'Некорректный путь к фото' };
      }
      nextAvatar = normalized;
    }
    const chat = await chatRepository.updateGroupAvatar(chatId, nextAvatar);
    if (!chat) return { success: false, error: 'Не удалось обновить фото' };
    return { success: true, chat };
  }

  async setMemberRole(
    chatId: string,
    actorId: string,
    targetUserId: string,
    role: 'ADMIN' | 'MEMBER'
  ): Promise<{ success: boolean; error?: string; userId?: string; role?: ChatMemberRole }> {
    const meta = await chatRepository.getChatMeta(chatId);
    if (!meta || meta.type !== ChatType.GROUP) {
      return { success: false, error: 'Группа не найдена' };
    }
    const isAdmin = await chatRepository.isGroupAdmin(chatId, actorId);
    if (!isAdmin) {
      return { success: false, error: 'Только админ может менять роли' };
    }
    if (targetUserId === meta.creatorId && role !== 'ADMIN') {
      return { success: false, error: 'Нельзя снять админку с создателя группы' };
    }
    if (targetUserId === actorId && role !== 'ADMIN') {
      const admins = await chatRepository.countAdmins(chatId);
      if (admins <= 1) {
        return { success: false, error: 'Нельзя снять админку с последнего админа' };
      }
    }
    const target = await chatRepository.getMembership(chatId, targetUserId);
    if (!target) {
      return { success: false, error: 'Участник не найден' };
    }
    const updated = await chatRepository.setMemberRole(
      chatId,
      targetUserId,
      role === 'ADMIN' ? ChatMemberRole.ADMIN : ChatMemberRole.MEMBER
    );
    if (!updated) return { success: false, error: 'Не удалось изменить роль' };
    return { success: true, userId: updated.userId, role: updated.role };
  }

  async removeMember(
    chatId: string,
    actorId: string,
    targetUserId: string
  ): Promise<{ success: boolean; error?: string }> {
    const meta = await chatRepository.getChatMeta(chatId);
    if (!meta || meta.type !== ChatType.GROUP) {
      return { success: false, error: 'Группа не найдена' };
    }
    const leavingSelf = actorId === targetUserId;
    if (!leavingSelf) {
      const isAdmin = await chatRepository.isGroupAdmin(chatId, actorId);
      if (!isAdmin) {
        return { success: false, error: 'Только админ может удалять участников' };
      }
    }
    if (targetUserId === meta.creatorId) {
      return { success: false, error: 'Нельзя удалить создателя группы' };
    }
    const target = await chatRepository.getMembership(chatId, targetUserId);
    if (!target) {
      return { success: false, error: 'Участник не найден' };
    }
    if (target.role === ChatMemberRole.ADMIN && !leavingSelf) {
      // admins can remove other admins except creator (already blocked)
    }
    if (leavingSelf && target.role === ChatMemberRole.ADMIN) {
      const admins = await chatRepository.countAdmins(chatId);
      if (admins <= 1) {
        return { success: false, error: 'Назначьте другого админа перед выходом' };
      }
    }
    await chatRepository.removeMember(chatId, targetUserId);
    return { success: true };
  }

  private async validateMessageIds(
    messageIds: string[],
    chatId: string,
    userId: string
  ): Promise<string[]> {
    const validIds = new Set(await messageRepository.getReadableMessageIds(messageIds, chatId, userId));
    return messageIds.filter((id) => validIds.has(id));
  }
}

export const chatService = new ChatService();
