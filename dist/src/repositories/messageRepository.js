"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_REACTION_EMOJIS = exports.messageRepository = exports.MessageRepository = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const ALLOWED_REACTION_EMOJIS = ['❤️', '👍', '😂', '🔥', '😮', '😢'];
exports.ALLOWED_REACTION_EMOJIS = ALLOWED_REACTION_EMOJIS;
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
        orderBy: { createdAt: 'asc' },
    },
};
function sanitizeMessage(message) {
    if (!message.deletedAt)
        return message;
    return {
        ...message,
        content: '',
        soundTokId: null,
        soundTok: null,
    };
}
class MessageRepository {
    async createMessage(data) {
        if (data.clientMessageId) {
            const existing = await prisma_1.prisma.message.findFirst({
                where: {
                    clientMessageId: data.clientMessageId,
                    chatId: data.chatId,
                },
                include: messageInclude,
            });
            if (existing) {
                return sanitizeMessage(existing);
            }
        }
        const created = await prisma_1.prisma.message.create({
            data: {
                content: data.content,
                senderId: data.senderId,
                receiverId: data.receiverId,
                chatId: data.chatId,
                clientMessageId: data.clientMessageId,
                soundTokId: data.soundTokId || null,
                status: client_1.MessageStatus.SENT,
            },
            include: messageInclude,
        });
        return sanitizeMessage(created);
    }
    async getMessagesByChatId(chatId, options = {}) {
        const { cursor, limit = 50, before } = options;
        const where = { chatId };
        if (before) {
            where.createdAt = { lt: before };
        }
        return (await prisma_1.prisma.message.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: { createdAt: 'asc' },
            include: messageInclude,
        })).map((message) => sanitizeMessage(message));
    }
    async softDeleteMessage(messageId, senderId, chatId) {
        const existing = await prisma_1.prisma.message.findFirst({
            where: { id: messageId, chatId, senderId, deletedAt: null },
            select: { id: true },
        });
        if (!existing)
            return null;
        const updated = await prisma_1.prisma.message.update({
            where: { id: messageId },
            data: { deletedAt: new Date(), content: '', soundTokId: null },
            include: messageInclude,
        });
        return sanitizeMessage(updated);
    }
    async toggleReaction(input) {
        if (!ALLOWED_REACTION_EMOJIS.includes(input.emoji)) {
            return null;
        }
        const message = await prisma_1.prisma.message.findFirst({
            where: { id: input.messageId, chatId: input.chatId, deletedAt: null },
            select: { id: true },
        });
        if (!message)
            return null;
        const existing = await prisma_1.prisma.messageReaction.findUnique({
            where: {
                messageId_userId_emoji: {
                    messageId: input.messageId,
                    userId: input.userId,
                    emoji: input.emoji,
                },
            },
        });
        if (existing) {
            await prisma_1.prisma.messageReaction.delete({ where: { id: existing.id } });
        }
        else {
            await prisma_1.prisma.messageReaction.create({
                data: {
                    messageId: input.messageId,
                    userId: input.userId,
                    emoji: input.emoji,
                },
            });
        }
        const updated = await prisma_1.prisma.message.findUnique({
            where: { id: input.messageId },
            include: messageInclude,
        });
        if (!updated)
            return null;
        return {
            message: sanitizeMessage(updated),
            added: !existing,
        };
    }
    async updateStatus(messageId, status, readAt) {
        return prisma_1.prisma.message.update({
            where: { id: messageId },
            data: {
                status,
                readAt: status === client_1.MessageStatus.READ ? readAt || new Date() : undefined,
            },
        });
    }
    async markAsRead(messageIds, receiverId) {
        const result = await prisma_1.prisma.message.updateMany({
            where: {
                id: { in: messageIds },
                receiverId,
                status: { not: client_1.MessageStatus.READ },
            },
            data: {
                status: client_1.MessageStatus.READ,
                readAt: new Date(),
            },
        });
        return result.count;
    }
    async getReadableMessageIds(messageIds, chatId, receiverId) {
        const messages = await prisma_1.prisma.message.findMany({
            where: {
                id: { in: messageIds },
                chatId,
                receiverId,
            },
            select: { id: true },
        });
        return messages.map((message) => message.id);
    }
    async getMessageForDelivery(messageId, chatId) {
        return prisma_1.prisma.message.findFirst({
            where: { id: messageId, chatId },
            select: { id: true, receiverId: true },
        });
    }
    async markAsDelivered(chatId, receiverId) {
        const messages = await prisma_1.prisma.message.findMany({
            where: {
                chatId,
                receiverId,
                status: client_1.MessageStatus.SENT,
            },
        });
        if (messages.length === 0)
            return [];
        await prisma_1.prisma.message.updateMany({
            where: {
                id: { in: messages.map(m => m.id) },
            },
            data: {
                status: client_1.MessageStatus.DELIVERED,
            },
        });
        return messages;
    }
    async getUnreadCount(chatId, userId) {
        const chatUser = await prisma_1.prisma.chatUser.findUnique({
            where: { userId_chatId: { userId, chatId } },
            select: { lastReadAt: true },
        });
        const chat = await prisma_1.prisma.chat.findUnique({
            where: { id: chatId },
            select: { type: true },
        });
        if (chat?.type === 'GROUP') {
            return prisma_1.prisma.message.count({
                where: {
                    chatId,
                    senderId: { not: userId },
                    deletedAt: null,
                    createdAt: { gt: chatUser?.lastReadAt ?? new Date(0) },
                },
            });
        }
        return prisma_1.prisma.message.count({
            where: {
                chatId,
                receiverId: userId,
                deletedAt: null,
                status: { in: [client_1.MessageStatus.SENT, client_1.MessageStatus.DELIVERED] },
            },
        });
    }
    async getLastMessagesForChats(chatIds) {
        const messages = await prisma_1.prisma.message.findMany({
            where: {
                chatId: { in: chatIds },
                deletedAt: null,
            },
            orderBy: { createdAt: 'desc' },
            distinct: ['chatId'],
            include: messageInclude,
        });
        const result = new Map();
        for (const msg of messages) {
            result.set(msg.chatId, sanitizeMessage(msg));
        }
        return result;
    }
}
exports.MessageRepository = MessageRepository;
exports.messageRepository = new MessageRepository();
//# sourceMappingURL=messageRepository.js.map