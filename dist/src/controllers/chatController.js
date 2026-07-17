"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnreadTotal = getUnreadTotal;
exports.getChats = getChats;
exports.getMessages = getMessages;
exports.createChat = createChat;
exports.createGroup = createGroup;
exports.pinChat = pinChat;
exports.sendMessage = sendMessage;
exports.markAsRead = markAsRead;
exports.getAvailableUsers = getAvailableUsers;
const chatService_1 = require("../services/chatService");
const userRepository_1 = require("../repositories/userRepository");
const chatRepository_1 = require("../repositories/chatRepository");
const blockService_1 = require("../services/blockService");
const messageValidation_1 = require("../utils/messageValidation");
const rateLimiter_1 = require("../utils/rateLimiter");
const socketServer_1 = require("../websocket/socketServer");
const MESSAGE_RATE_LIMIT = 30;
const MESSAGE_RATE_WINDOW_MS = 60000;
function formatChat(chat, currentUserId, unreadCount = 0) {
    const currentMembership = chat.users.find((u) => u.userId === currentUserId);
    const otherUser = chat.type === 'DIRECT'
        ? chat.users.find((u) => u.user.id !== currentUserId)?.user
        : null;
    return {
        id: chat.id,
        type: chat.type,
        name: chat.name,
        creatorId: chat.creatorId,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        unreadCount,
        isPinned: !!currentMembership?.pinnedAt,
        pinnedAt: currentMembership?.pinnedAt ?? null,
        memberCount: chat.users.length,
        otherUser: otherUser
            ? {
                id: otherUser.id,
                username: otherUser.username,
                displayName: otherUser.displayName,
                avatar: otherUser.avatar,
            }
            : null,
        users: chat.users.map((cu) => ({
            id: cu.id,
            userId: cu.userId,
            chatId: cu.chatId,
            pinnedAt: cu.pinnedAt,
            createdAt: cu.createdAt,
            user: {
                id: cu.user.id,
                username: cu.user.username,
                displayName: cu.user.displayName,
                avatar: cu.user.avatar,
            },
        })),
        messages: chat.messages || [],
    };
}
async function getUnreadTotal(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const chats = await chatService_1.chatService.getUserChats(req.user.id);
        const unreadCounts = await chatService_1.chatService.getUnreadCounts(req.user.id, chats.map(chat => chat.id));
        let total = 0;
        unreadCounts.forEach(count => {
            total += count;
        });
        res.json({ total });
    }
    catch (error) {
        console.error('getUnreadTotal error:', error);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
}
async function getChats(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const chats = await chatService_1.chatService.getUserChats(req.user.id);
        const unreadCounts = await chatService_1.chatService.getUnreadCounts(req.user.id, chats.map(chat => chat.id));
        const formattedChats = chats.map((chat) => formatChat(chat, req.user.id, unreadCounts.get(chat.id) || 0));
        res.json(formattedChats);
    }
    catch (error) {
        console.error('getChats error:', error);
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
}
async function getMessages(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { chatId } = req.params;
        const { cursor, limit = '50' } = req.query;
        const chatInfo = await chatService_1.chatService.getChatHistory(chatId, req.user.id, {
            cursor: cursor,
            limit: parseInt(limit, 10),
        });
        if (!chatInfo) {
            return res.status(403).json({ error: 'Access denied or chat not found' });
        }
        res.json({
            chat: formatChat(chatInfo.chat, req.user.id, chatInfo.unreadCount),
            messages: chatInfo.messages,
            unreadCount: chatInfo.unreadCount,
        });
    }
    catch (error) {
        console.error('getMessages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
}
async function createChat(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { receiverId } = req.body;
        if (!receiverId) {
            return res.status(400).json({ error: 'Receiver ID required' });
        }
        if (receiverId === req.user.id) {
            return res.status(400).json({ error: 'Cannot chat with yourself' });
        }
        const chat = await chatService_1.chatService.createOrGetChat(req.user.id, receiverId);
        if (!chat) {
            return res.status(404).json({ error: 'User not found' });
        }
        const isBlocked = await blockService_1.blockService.isEitherBlocked(req.user.id, receiverId);
        if (isBlocked) {
            return res.status(403).json({ error: 'Невозможно начать чат с этим пользователем' });
        }
        const otherUser = chat.users.find((u) => u.user.id !== req.user.id)?.user;
        res.status(201).json(formatChat(chat, req.user.id, 0));
    }
    catch (error) {
        console.error('createChat error:', error);
        res.status(500).json({ error: 'Failed to create chat' });
    }
}
async function createGroup(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { name, memberIds } = req.body;
        if (!Array.isArray(memberIds)) {
            return res.status(400).json({ error: 'memberIds must be an array' });
        }
        const result = await chatService_1.chatService.createGroup(req.user.id, name, memberIds);
        if (!result.success || !result.chat) {
            return res.status(400).json({ error: result.error });
        }
        res.status(201).json(formatChat(result.chat, req.user.id, 0));
    }
    catch (error) {
        console.error('createGroup error:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
}
async function pinChat(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { chatId } = req.params;
        const { pinned } = req.body;
        if (typeof pinned !== 'boolean') {
            return res.status(400).json({ error: 'pinned must be boolean' });
        }
        const result = await chatService_1.chatService.togglePin(chatId, req.user.id, pinned);
        if (!result.success) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json({
            success: true,
            pinned,
            isPinned: !!result.pinnedAt,
            pinnedAt: result.pinnedAt,
        });
    }
    catch (error) {
        console.error('pinChat error:', error);
        res.status(500).json({ error: 'Failed to pin chat' });
    }
}
async function sendMessage(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { chatId } = req.params;
        const { content, clientMessageId, receiverId: bodyReceiverId, soundTokId } = req.body;
        const validation = (0, messageValidation_1.validateMessageContent)(content, {
            allowEmpty: !!soundTokId,
        });
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        if (!soundTokId && !validation.content) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }
        const rateLimit = (0, rateLimiter_1.checkRateLimit)((0, rateLimiter_1.messageRateLimitKey)(req.user.id), MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);
        if (!rateLimit.allowed) {
            return res.status(429).json({
                error: 'Слишком много сообщений. Подождите немного.',
                retryAfterMs: rateLimit.retryAfterMs,
            });
        }
        const isMember = await chatRepository_1.chatRepository.isChatMember(chatId, req.user.id);
        if (!isMember) {
            return res.status(403).json({ error: 'Not a member of this chat' });
        }
        const receiverId = bodyReceiverId || await chatRepository_1.chatRepository.getOtherParticipant(chatId, req.user.id);
        const result = await chatService_1.chatService.sendMessage({
            content: validation.content ?? '',
            senderId: req.user.id,
            receiverId: receiverId ?? null,
            chatId,
            clientMessageId: clientMessageId || `${req.user.id}_${Date.now()}`,
            soundTokId: typeof soundTokId === 'string' ? soundTokId : null,
        });
        if (!result.success || !result.message) {
            return res.status(400).json({ error: result.error });
        }
        (0, socketServer_1.getIO)()?.to(`chat:${chatId}`).emit('message:new', result.message);
        res.status(201).json(result.message);
    }
    catch (error) {
        console.error('sendMessage error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
}
async function markAsRead(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { chatId } = req.params;
        const { messageIds } = req.body;
        if (!Array.isArray(messageIds)) {
            return res.status(400).json({ error: 'Message IDs array required' });
        }
        const result = await chatService_1.chatService.markMessagesAsRead(messageIds, req.user.id, chatId);
        res.json({ count: result.count });
    }
    catch (error) {
        console.error('markAsRead error:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
}
async function getAvailableUsers(req, res) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { q } = req.query;
        if (!q || typeof q !== 'string' || q.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }
        const users = await userRepository_1.userRepository.searchUsers(q, 10);
        const formatted = users
            .filter(u => u.id !== req.user.id)
            .map(u => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            avatar: u.avatar,
            bio: u.bio,
        }));
        res.json(formatted);
    }
    catch (error) {
        console.error('getAvailableUsers error:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
}
//# sourceMappingURL=chatController.js.map