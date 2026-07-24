import { NotificationType } from '@prisma/client';
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
export declare const notificationService: {
    create(input: {
        userId: string;
        actorId: string;
        type: NotificationType;
        entityType?: string;
        entityId?: string;
    }): Promise<NotificationPayload | null>;
    list(userId: string, limit?: number): Promise<{
        items: ({
            actor: {
                id: string;
                username: string;
                displayName: string | null;
                avatar: string | null;
            };
        } & {
            id: string;
            createdAt: Date;
            readAt: Date | null;
            userId: string;
            type: import(".prisma/client").$Enums.NotificationType;
            entityType: string | null;
            entityId: string | null;
            actorId: string;
        })[];
        unreadCount: number;
    }>;
    markRead(userId: string, ids?: string[]): Promise<number>;
    clear(userId: string): Promise<number>;
};
//# sourceMappingURL=notificationService.d.ts.map