"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatRepository = exports.ChatRepository = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
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
};
const chatListInclude = {
    users: chatUserInclude,
    messages: {
        where: { deletedAt: null },
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
function isExactDirectPair(chat, userId1, userId2) {
    if (chat.type === client_1.ChatType.GROUP)
        return false;
    if (chat.users.length !== 2)
        return false;
    const ids = new Set(chat.users.map((u) => u.userId));
    return ids.has(userId1) && ids.has(userId2);
}
function peerKeyForDirect(chat, currentUserId) {
    if (chat.type === client_1.ChatType.GROUP)
        return null;
    if (chat.users.length !== 2)
        return null;
    const other = chat.users.find((u) => u.userId !== currentUserId);
    return other?.userId ?? null;
}
function scoreDirectChat(chat, userId) {
    const membership = chat.users.find((u) => u.userId === userId);
    const hasMessages = (chat.messages?.length || 0) > 0 ? 1000000000 : 0;
    const pinned = membership?.pinnedAt ? membership.pinnedAt.getTime() : 0;
    const updated = chat.updatedAt.getTime();
    return hasMessages + pinned + updated;
}
class ChatRepository {
    async getChatsByUserId(userId) {
        await this.mergeAllDuplicateDirectChatsForUser(userId);
        const chats = await prisma_1.prisma.chat.findMany({
            where: {
                users: { some: { userId } },
            },
            include: chatListInclude,
        });
        const typed = chats;
        const unique = [];
        const seenPeers = new Set();
        for (const chat of typed) {
            const peer = peerKeyForDirect(chat, userId);
            if (peer) {
                if (seenPeers.has(peer))
                    continue;
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
            if (aPinned)
                return -1;
            if (bPinned)
                return 1;
            return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
    }
    async getChatById(chatId) {
        const chat = await prisma_1.prisma.chat.findUnique({
            where: { id: chatId },
            include: {
                users: chatUserInclude,
            },
        });
        return chat;
    }
    async getChatMeta(chatId) {
        return prisma_1.prisma.chat.findUnique({
            where: { id: chatId },
            select: { id: true, type: true, name: true, creatorId: true },
        });
    }
    async isChatMember(chatId, userId) {
        const chatUser = await prisma_1.prisma.chatUser.findFirst({
            where: { chatId, userId },
        });
        return !!chatUser;
    }
    async usersShareChat(userId, otherUserId) {
        const chat = await prisma_1.prisma.chat.findFirst({
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
    async findDirectChatsBetween(userId1, userId2) {
        const chats = await prisma_1.prisma.chat.findMany({
            where: {
                type: client_1.ChatType.DIRECT,
                AND: [
                    { users: { some: { userId: userId1 } } },
                    { users: { some: { userId: userId2 } } },
                ],
            },
            include: chatListInclude,
        });
        return chats.filter((chat) => isExactDirectPair(chat, userId1, userId2));
    }
    async mergeDirectChatDuplicates(duplicates, preferUserId) {
        if (duplicates.length === 0) {
            throw new Error('No chats to merge');
        }
        if (duplicates.length === 1) {
            return duplicates[0];
        }
        const sorted = [...duplicates].sort((a, b) => scoreDirectChat(b, preferUserId) - scoreDirectChat(a, preferUserId));
        const primary = sorted[0];
        const extras = sorted.slice(1);
        for (const extra of extras) {
            await prisma_1.prisma.$transaction(async (tx) => {
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
                    }
                    catch {
                        await tx.message.delete({ where: { id: message.id } });
                    }
                }
                for (const membership of extra.users) {
                    const primaryMembership = await tx.chatUser.findUnique({
                        where: {
                            userId_chatId: { userId: membership.userId, chatId: primary.id },
                        },
                    });
                    if (!primaryMembership)
                        continue;
                    await tx.chatUser.update({
                        where: { id: primaryMembership.id },
                        data: {
                            pinnedAt: primaryMembership.pinnedAt ?? membership.pinnedAt ?? null,
                            lastReadAt: primaryMembership.lastReadAt && membership.lastReadAt
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
        await prisma_1.prisma.chat.update({
            where: { id: primary.id },
            data: { updatedAt: new Date() },
        });
        const refreshed = await prisma_1.prisma.chat.findUnique({
            where: { id: primary.id },
            include: chatListInclude,
        });
        return refreshed;
    }
    async mergeAllDuplicateDirectChatsForUser(userId) {
        const chats = await prisma_1.prisma.chat.findMany({
            where: {
                type: client_1.ChatType.DIRECT,
                users: { some: { userId } },
            },
            include: chatListInclude,
        });
        const byPeer = new Map();
        for (const chat of chats) {
            const peer = peerKeyForDirect(chat, userId);
            if (!peer)
                continue;
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
    async createChat(userId1, userId2) {
        const existing = await this.findDirectChatsBetween(userId1, userId2);
        if (existing.length === 1) {
            return existing[0];
        }
        if (existing.length > 1) {
            return this.mergeDirectChatDuplicates(existing, userId1);
        }
        try {
            const chat = await prisma_1.prisma.chat.create({
                data: {
                    type: client_1.ChatType.DIRECT,
                    users: {
                        create: [{ userId: userId1 }, { userId: userId2 }],
                    },
                },
                include: chatListInclude,
            });
            return chat;
        }
        catch {
            const raced = await this.findDirectChatsBetween(userId1, userId2);
            if (raced.length > 0) {
                return raced.length === 1
                    ? raced[0]
                    : this.mergeDirectChatDuplicates(raced, userId1);
            }
            throw new Error('Failed to create chat');
        }
    }
    async createGroupChat(creatorId, name, memberIds) {
        const uniqueMembers = [...new Set([creatorId, ...memberIds])];
        const chat = await prisma_1.prisma.chat.create({
            data: {
                type: client_1.ChatType.GROUP,
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
        return chat;
    }
    async setChatPinned(chatId, userId, pinned) {
        const updated = await prisma_1.prisma.chatUser.update({
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
    async updateLastReadAt(chatId, userId) {
        await prisma_1.prisma.chatUser.update({
            where: {
                userId_chatId: { userId, chatId },
            },
            data: {
                lastReadAt: new Date(),
            },
        });
    }
    async updateTimestamp(chatId) {
        await prisma_1.prisma.chat.update({
            where: { id: chatId },
            data: { updatedAt: new Date() },
        });
    }
    async getChatParticipants(chatId) {
        const chatUsers = await prisma_1.prisma.chatUser.findMany({
            where: { chatId },
            select: { userId: true },
        });
        return chatUsers.map((cu) => cu.userId);
    }
    async getOtherParticipant(chatId, userId) {
        const otherUser = await prisma_1.prisma.chatUser.findFirst({
            where: {
                chatId,
                userId: { not: userId },
            },
            select: { userId: true },
        });
        return otherUser?.userId || null;
    }
}
exports.ChatRepository = ChatRepository;
exports.chatRepository = new ChatRepository();
//# sourceMappingURL=chatRepository.js.map