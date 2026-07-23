"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIO = getIO;
exports.createSocketServer = createSocketServer;
exports.getUserOnlineStatus = getUserOnlineStatus;
exports.getActiveChatUsers = getActiveChatUsers;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const chatService_1 = require("../services/chatService");
const chatRepository_1 = require("../repositories/chatRepository");
const messageRepository_1 = require("../repositories/messageRepository");
const profileService_1 = require("../services/profileService");
const messageValidation_1 = require("../utils/messageValidation");
const rateLimiter_1 = require("../utils/rateLimiter");
const security_1 = require("../middleware/security");
const notificationService_1 = require("../services/notificationService");
const userSockets = new Map();
const activeChatUsers = new Map();
const MAX_MESSAGE_IDS_PER_READ = 100;
function isSafeIdentifier(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
let ioInstance = null;
function getIO() {
    return ioInstance;
}
function createSocketServer(httpServer) {
    const JWT_SECRET = (0, security_1.requireJwtSecret)();
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: (0, security_1.getAllowedOrigins)(),
            methods: ['GET', 'POST'],
            credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        connectTimeout: 10000,
    });
    ioInstance = io;
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (typeof token !== 'string' || !token) {
                return next(new Error('Authentication required'));
            }
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            const user = await profileService_1.profileService.getProfile(decoded.userId);
            if (!user) {
                return next(new Error('User not found'));
            }
            socket.userId = decoded.userId;
            socket.username = user.username;
            next();
        }
        catch (error) {
            next(new Error('Invalid token'));
        }
    });
    io.on('connection', (socket) => {
        const userId = socket.userId;
        const username = socket.username;
        console.log(`[Socket] User connected: ${username} (${userId})`);
        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        socket.join(`user:${userId}`);
        io.to(`user:${userId}`).emit('user:online', { userId, isOnline: true });
        activeChatUsers.forEach((users, chatId) => {
            if (users.has(userId)) {
                io.to(`chat:${chatId}`).emit('chat:presence', {
                    chatId,
                    userId,
                    isOnline: true,
                });
            }
        });
        socket.on('chat:join', async (chatId) => {
            try {
                if (!isSafeIdentifier(chatId)) {
                    socket.emit('error', { message: 'Invalid chat ID', code: 'INVALID_CHAT' });
                    return;
                }
                const isMember = await chatRepository_1.chatRepository.isChatMember(chatId, userId);
                if (!isMember) {
                    socket.emit('error', { message: 'Not a member of this chat', code: 'NOT_MEMBER' });
                    return;
                }
                socket.join(`chat:${chatId}`);
                if (!activeChatUsers.has(chatId)) {
                    activeChatUsers.set(chatId, new Set());
                }
                activeChatUsers.get(chatId).add(userId);
                const participants = await chatRepository_1.chatRepository.getChatParticipants(chatId);
                for (const participantId of participants) {
                    if (participantId === userId)
                        continue;
                    socket.emit('chat:presence', {
                        chatId,
                        userId: participantId,
                        isOnline: userSockets.has(participantId),
                    });
                }
                socket.to(`chat:${chatId}`).emit('chat:presence', {
                    chatId,
                    userId,
                    isOnline: true,
                });
                const deliveredIds = await chatService_1.chatService.markChatAsDelivered(chatId, userId);
                deliveredIds.forEach(messageId => {
                    socket.to(`chat:${chatId}`).emit('message:delivered', {
                        clientMessageId: '',
                        messageId
                    });
                });
                console.log(`[Socket] ${username} joined chat ${chatId}`);
            }
            catch (error) {
                console.error('[Socket] Error joining chat:', error);
                socket.emit('error', { message: 'Failed to join chat', code: 'JOIN_ERROR' });
            }
        });
        socket.on('chat:leave', async (chatId) => {
            if (!isSafeIdentifier(chatId) || !socket.rooms.has(`chat:${chatId}`))
                return;
            const isMember = await chatRepository_1.chatRepository.isChatMember(chatId, userId);
            if (!isMember)
                return;
            socket.leave(`chat:${chatId}`);
            const chatUsers = activeChatUsers.get(chatId);
            if (chatUsers) {
                chatUsers.delete(userId);
                if (chatUsers.size === 0) {
                    activeChatUsers.delete(chatId);
                }
            }
            socket.to(`chat:${chatId}`).emit('chat:presence', {
                chatId,
                userId,
                isOnline: userSockets.has(userId),
            });
            console.log(`[Socket] ${username} left chat ${chatId}`);
        });
        socket.on('message:send', async (data, callback) => {
            try {
                if (!isSafeIdentifier(data.chatId) || !isSafeIdentifier(data.clientMessageId)) {
                    callback({ success: false, error: 'Invalid message metadata', clientMessageId: data.clientMessageId });
                    return;
                }
                const validation = (0, messageValidation_1.validateMessageContent)(data.content, {
                    allowEmpty: !!data.soundTokId,
                });
                if (!validation.valid) {
                    callback({
                        success: false,
                        error: validation.error,
                        clientMessageId: data.clientMessageId,
                    });
                    return;
                }
                if (!data.soundTokId && !validation.content) {
                    callback({
                        success: false,
                        error: 'Сообщение не может быть пустым',
                        clientMessageId: data.clientMessageId,
                    });
                    return;
                }
                const rateLimit = (0, rateLimiter_1.checkRateLimit)((0, rateLimiter_1.messageRateLimitKey)(userId), 30, 60000);
                if (!rateLimit.allowed) {
                    callback({
                        success: false,
                        error: 'Слишком много сообщений. Подождите немного.',
                        clientMessageId: data.clientMessageId,
                    });
                    return;
                }
                const clientMessageId = data.clientMessageId;
                const result = await chatService_1.chatService.sendMessage({
                    content: validation.content ?? '',
                    senderId: userId,
                    receiverId: data.receiverId ?? null,
                    chatId: data.chatId,
                    clientMessageId,
                    soundTokId: data.soundTokId ?? null,
                });
                if (!result.success || !result.message) {
                    const response = {
                        success: false,
                        error: result.error || 'Failed to send message',
                        clientMessageId,
                    };
                    callback(response);
                    return;
                }
                const message = result.message;
                io.to(`chat:${data.chatId}`).emit('message:new', message);
                if (message.receiverId) {
                    void notificationService_1.notificationService.create({
                        userId: message.receiverId,
                        actorId: userId,
                        type: 'MESSAGE',
                        entityType: 'chat',
                        entityId: data.chatId,
                    }).catch((error) => console.error('Failed to create message notification:', error));
                }
                const chatUsers = activeChatUsers.get(data.chatId);
                const receiverInChat = data.receiverId ? chatUsers?.has(data.receiverId) : false;
                if (receiverInChat) {
                    io.to(`chat:${data.chatId}`).emit('message:delivered', {
                        clientMessageId,
                        messageId: message.id,
                    });
                }
                const response = {
                    success: true,
                    message,
                    clientMessageId,
                };
                callback(response);
                console.log(`[Socket] Message sent in chat ${data.chatId}`);
            }
            catch (error) {
                console.error('[Socket] Error sending message:', error);
                callback({
                    success: false,
                    error: 'Internal server error',
                    clientMessageId: data.clientMessageId,
                });
            }
        });
        socket.on('message:read', async (data) => {
            try {
                if (!isSafeIdentifier(data.chatId) || !Array.isArray(data.messageIds)
                    || data.messageIds.length > MAX_MESSAGE_IDS_PER_READ
                    || data.messageIds.some((id) => !isSafeIdentifier(id))) {
                    return;
                }
                const result = await chatService_1.chatService.markMessagesAsRead(data.messageIds, userId, data.chatId);
                if (result.count > 0) {
                    for (const messageId of result.updatedIds) {
                        socket.to(`chat:${data.chatId}`).emit('message:status', {
                            messageId,
                            status: 'READ',
                            readAt: new Date(),
                        });
                    }
                }
                console.log(`[Socket] ${result.count} messages marked as read in chat ${data.chatId}`);
            }
            catch (error) {
                console.error('[Socket] Error marking messages as read:', error);
            }
        });
        socket.on('message:deliver', async (data) => {
            try {
                if (!isSafeIdentifier(data.chatId) || !isSafeIdentifier(data.messageId))
                    return;
                const isMember = await chatRepository_1.chatRepository.isChatMember(data.chatId, userId);
                if (!isMember)
                    return;
                const message = await messageRepository_1.messageRepository.getMessageForDelivery(data.messageId, data.chatId);
                if (!message || message.receiverId !== userId)
                    return;
                socket.to(`chat:${data.chatId}`).emit('message:delivered', {
                    clientMessageId: '',
                    messageId: data.messageId,
                });
            }
            catch (error) {
                console.error('[Socket] Error delivering message:', error);
            }
        });
        socket.on('chat:typing', async (data) => {
            if (!isSafeIdentifier(data.chatId) || typeof data.isTyping !== 'boolean')
                return;
            const rateLimit = (0, rateLimiter_1.checkRateLimit)(`typing:${userId}:${data.chatId}`, 20, 10000);
            if (!rateLimit.allowed)
                return;
            const isMember = await chatRepository_1.chatRepository.isChatMember(data.chatId, userId);
            if (!isMember)
                return;
            socket.to(`chat:${data.chatId}`).emit('chat:typing', {
                chatId: data.chatId,
                userId,
                isTyping: data.isTyping,
            });
        });
        socket.on('user:subscribe', async (targetUserId) => {
            if (!isSafeIdentifier(targetUserId) || targetUserId === userId)
                return;
            const sharesChat = await chatRepository_1.chatRepository.usersShareChat(userId, targetUserId);
            if (!sharesChat) {
                socket.emit('error', { message: 'Presence access denied', code: 'PRESENCE_DENIED' });
                return;
            }
            socket.join(`user:${targetUserId}`);
            socket.emit('user:online', {
                userId: targetUserId,
                isOnline: userSockets.has(targetUserId),
            });
        });
        socket.on('disconnect', (reason) => {
            console.log(`[Socket] User disconnected: ${username} (${userId}), reason: ${reason}`);
            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    userSockets.delete(userId);
                    io.to(`user:${userId}`).emit('user:online', { userId, isOnline: false });
                    activeChatUsers.forEach((users, chatId) => {
                        if (users.has(userId)) {
                            io.to(`chat:${chatId}`).emit('chat:presence', {
                                chatId,
                                userId,
                                isOnline: false,
                            });
                        }
                    });
                }
            }
            activeChatUsers.forEach((users, chatId) => {
                if (users.has(userId)) {
                    users.delete(userId);
                    if (users.size === 0) {
                        activeChatUsers.delete(chatId);
                    }
                }
            });
        });
    });
    return io;
}
function getUserOnlineStatus(userId) {
    return userSockets.has(userId);
}
function getActiveChatUsers(chatId) {
    return Array.from(activeChatUsers.get(chatId) || new Set());
}
//# sourceMappingURL=socketServer.js.map