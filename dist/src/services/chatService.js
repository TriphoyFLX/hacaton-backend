"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatService = exports.ChatService = void 0;
const client_1 = require("@prisma/client");
const messageRepository_1 = require("../repositories/messageRepository");
const chatRepository_1 = require("../repositories/chatRepository");
const userRepository_1 = require("../repositories/userRepository");
const blockRepository_1 = require("../repositories/blockRepository");
const messageValidation_1 = require("../utils/messageValidation");
const prisma = new client_1.PrismaClient();
class ChatService {
    async sendMessage(data) {
        try {
            const hasSoundTok = !!data.soundTokId;
            const validation = (0, messageValidation_1.validateMessageContent)(data.content, {
                allowEmpty: hasSoundTok,
            });
            if (!validation.valid || validation.content === undefined) {
                return { success: false, error: validation.error || 'Invalid message' };
            }
            if (!hasSoundTok && !validation.content) {
                return { success: false, error: 'Сообщение не может быть пустым' };
            }
            let soundTokId = null;
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
            const chatMeta = await chatRepository_1.chatRepository.getChatMeta(data.chatId);
            if (!chatMeta) {
                return { success: false, error: 'Chat not found' };
            }
            const isMember = await chatRepository_1.chatRepository.isChatMember(data.chatId, data.senderId);
            if (!isMember) {
                return { success: false, error: 'Not a member of this chat' };
            }
            let receiverId = data.receiverId ?? null;
            if (chatMeta.type === client_1.ChatType.DIRECT) {
                if (!receiverId) {
                    receiverId = await chatRepository_1.chatRepository.getOtherParticipant(data.chatId, data.senderId);
                }
                if (!receiverId) {
                    return { success: false, error: 'Receiver not in chat' };
                }
                const isBlocked = await blockRepository_1.blockRepository.isEitherBlocked(data.senderId, receiverId);
                if (isBlocked) {
                    return { success: false, error: 'Невозможно отправить сообщение этому пользователю' };
                }
                const receiverInChat = await chatRepository_1.chatRepository.isChatMember(data.chatId, receiverId);
                if (!receiverInChat) {
                    return { success: false, error: 'Receiver not in chat' };
                }
            }
            else {
                receiverId = null;
            }
            const message = await messageRepository_1.messageRepository.createMessage({
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
            await chatRepository_1.chatRepository.updateTimestamp(data.chatId);
            return { success: true, message };
        }
        catch (error) {
            console.error('ChatService.sendMessage error:', error);
            return { success: false, error: 'Internal server error' };
        }
    }
    async getChatHistory(chatId, userId, options = {}) {
        const isMember = await chatRepository_1.chatRepository.isChatMember(chatId, userId);
        if (!isMember)
            return null;
        const [chat, messages, unreadCount] = await Promise.all([
            chatRepository_1.chatRepository.getChatById(chatId),
            messageRepository_1.messageRepository.getMessagesByChatId(chatId, {
                ...options,
                limit: options.limit || 50,
            }),
            messageRepository_1.messageRepository.getUnreadCount(chatId, userId),
        ]);
        if (!chat)
            return null;
        return { chat, messages, unreadCount };
    }
    async getUserChats(userId) {
        return chatRepository_1.chatRepository.getChatsByUserId(userId);
    }
    async createOrGetChat(userId1, userId2) {
        const [user1, user2] = await Promise.all([
            userRepository_1.userRepository.getUserById(userId1),
            userRepository_1.userRepository.getUserById(userId2),
        ]);
        if (!user1 || !user2 || userId1 === userId2)
            return null;
        const isBlocked = await blockRepository_1.blockRepository.isEitherBlocked(userId1, userId2);
        if (isBlocked)
            return null;
        return chatRepository_1.chatRepository.createChat(userId1, userId2);
    }
    async createGroup(creatorId, name, memberIds) {
        const trimmedName = name?.trim();
        if (!trimmedName || trimmedName.length < 2) {
            return { success: false, error: 'Название группы должно быть минимум 2 символа' };
        }
        const uniqueMembers = [...new Set(memberIds.filter((id) => id !== creatorId))];
        if (uniqueMembers.length < 1) {
            return { success: false, error: 'Добавьте хотя бы одного участника' };
        }
        for (const memberId of uniqueMembers) {
            const user = await userRepository_1.userRepository.getUserById(memberId);
            if (!user) {
                return { success: false, error: 'Один из участников не найден' };
            }
            const blocked = await blockRepository_1.blockRepository.isEitherBlocked(creatorId, memberId);
            if (blocked) {
                return { success: false, error: 'Нельзя добавить заблокированного пользователя' };
            }
        }
        const chat = await chatRepository_1.chatRepository.createGroupChat(creatorId, trimmedName, uniqueMembers);
        return { success: true, chat };
    }
    async togglePin(chatId, userId, pinned) {
        const isMember = await chatRepository_1.chatRepository.isChatMember(chatId, userId);
        if (!isMember) {
            return { success: false, pinnedAt: null };
        }
        const pinnedAt = await chatRepository_1.chatRepository.setChatPinned(chatId, userId, pinned);
        return { success: true, pinnedAt };
    }
    async markMessagesAsRead(messageIds, userId, chatId) {
        const isMember = await chatRepository_1.chatRepository.isChatMember(chatId, userId);
        if (!isMember) {
            return { count: 0, updatedIds: [] };
        }
        await chatRepository_1.chatRepository.updateLastReadAt(chatId, userId);
        const chatMeta = await chatRepository_1.chatRepository.getChatMeta(chatId);
        if (chatMeta?.type === client_1.ChatType.GROUP) {
            return { count: 1, updatedIds: messageIds };
        }
        const validMessageIds = await this.validateMessageIds(messageIds, chatId, userId);
        if (validMessageIds.length === 0) {
            return { count: 0, updatedIds: [] };
        }
        const count = await messageRepository_1.messageRepository.markAsRead(validMessageIds, userId);
        return { count, updatedIds: validMessageIds };
    }
    async markChatAsDelivered(chatId, userId) {
        const messages = await messageRepository_1.messageRepository.markAsDelivered(chatId, userId);
        return messages.map((m) => m.id);
    }
    async getUnreadCounts(userId, chatIds) {
        const counts = new Map();
        await Promise.all(chatIds.map(async (chatId) => {
            const count = await messageRepository_1.messageRepository.getUnreadCount(chatId, userId);
            counts.set(chatId, count);
        }));
        return counts;
    }
    async validateMessageIds(messageIds, chatId, userId) {
        const messages = await messageRepository_1.messageRepository.getMessagesByChatId(chatId);
        const validIds = new Set(messages
            .filter((m) => m.receiverId === userId && messageIds.includes(m.id))
            .map((m) => m.id));
        return messageIds.filter((id) => validIds.has(id));
    }
}
exports.ChatService = ChatService;
exports.chatService = new ChatService();
//# sourceMappingURL=chatService.js.map