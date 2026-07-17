"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageRepository = exports.MessageRepository = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
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
};
class MessageRepository {
    async createMessage(data) {
        if (data.clientMessageId) {
            const existing = await prisma.message.findFirst({
                where: {
                    clientMessageId: data.clientMessageId,
                    chatId: data.chatId,
                },
                include: messageInclude,
            });
            if (existing) {
                return existing;
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
                status: client_1.MessageStatus.SENT,
            },
            include: messageInclude,
        });
    }
    async getMessagesByChatId(chatId, options = {}) {
        const { cursor, limit = 50, before } = options;
        const where = { chatId };
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
        });
    }
    async updateStatus(messageId, status, readAt) {
        return prisma.message.update({
            where: { id: messageId },
            data: {
                status,
                readAt: status === client_1.MessageStatus.READ ? readAt || new Date() : undefined,
            },
        });
    }
    async markAsRead(messageIds, receiverId) {
        const result = await prisma.message.updateMany({
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
    async markAsDelivered(chatId, receiverId) {
        const messages = await prisma.message.findMany({
            where: {
                chatId,
                receiverId,
                status: client_1.MessageStatus.SENT,
            },
        });
        if (messages.length === 0)
            return [];
        await prisma.message.updateMany({
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
                status: { in: [client_1.MessageStatus.SENT, client_1.MessageStatus.DELIVERED] },
            },
        });
    }
    async getLastMessagesForChats(chatIds) {
        const messages = await prisma.message.findMany({
            where: {
                chatId: { in: chatIds },
            },
            orderBy: { createdAt: 'desc' },
            distinct: ['chatId'],
            include: messageInclude,
        });
        const result = new Map();
        for (const msg of messages) {
            result.set(msg.chatId, msg);
        }
        return result;
    }
}
exports.MessageRepository = MessageRepository;
exports.messageRepository = new MessageRepository();
//# sourceMappingURL=messageRepository.js.map