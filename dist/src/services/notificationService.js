"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const prisma_1 = require("../lib/prisma");
const socketServer_1 = require("../websocket/socketServer");
const notificationInclude = {
    actor: {
        select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
        },
    },
};
exports.notificationService = {
    async create(input) {
        if (input.userId === input.actorId)
            return null;
        const notification = await prisma_1.prisma.notification.create({
            data: input,
            include: notificationInclude,
        });
        (0, socketServer_1.getIO)()?.to(`user:${input.userId}`).emit('notification:new', notification);
        return notification;
    },
    async list(userId, limit = 30) {
        const [items, unreadCount] = await Promise.all([
            prisma_1.prisma.notification.findMany({
                where: { userId },
                include: notificationInclude,
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            prisma_1.prisma.notification.count({ where: { userId, readAt: null } }),
        ]);
        return { items, unreadCount };
    },
    async markRead(userId, ids) {
        const where = ids?.length
            ? { userId, id: { in: ids } }
            : { userId, readAt: null };
        await prisma_1.prisma.notification.updateMany({ where, data: { readAt: new Date() } });
        return prisma_1.prisma.notification.count({ where: { userId, readAt: null } });
    },
};
//# sourceMappingURL=notificationService.js.map