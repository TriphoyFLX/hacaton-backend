import { NotificationType, PrismaClient } from '@prisma/client';
import { getIO } from '../websocket/socketServer';

const prisma = new PrismaClient();

export type NotificationPayload = {
  id: string;
  type: NotificationType;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actor: {
    id: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
  };
};

const notificationInclude = {
  actor: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
    },
  },
} as const;

export const notificationService = {
  async create(input: {
    userId: string;
    actorId: string;
    type: NotificationType;
    entityType?: string;
    entityId?: string;
  }): Promise<NotificationPayload | null> {
    if (input.userId === input.actorId) return null;

    const notification = await prisma.notification.create({
      data: input,
      include: notificationInclude,
    });

    getIO()?.to(`user:${input.userId}`).emit('notification:new', notification);
    return notification;
  },

  async list(userId: string, limit = 30) {
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        include: notificationInclude,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  },

  async markRead(userId: string, ids?: string[]) {
    const where = ids?.length
      ? { userId, id: { in: ids } }
      : { userId, readAt: null };
    await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
    return prisma.notification.count({ where: { userId, readAt: null } });
  },
};
