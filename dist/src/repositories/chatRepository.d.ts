import { ChatType } from '@prisma/client';
export interface ChatWithUsers {
    id: string;
    type: ChatType;
    name?: string | null;
    creatorId?: string | null;
    createdAt: Date;
    updatedAt: Date;
    users: {
        id: string;
        userId: string;
        chatId: string;
        pinnedAt?: Date | null;
        lastReadAt?: Date | null;
        createdAt: Date;
        user: {
            id: string;
            username: string;
            displayName?: string | null;
            avatar?: string | null;
        };
    }[];
    messages?: any[];
}
export declare class ChatRepository {
    getChatsByUserId(userId: string): Promise<ChatWithUsers[]>;
    getChatById(chatId: string): Promise<ChatWithUsers | null>;
    getChatMeta(chatId: string): Promise<{
        id: string;
        name: string | null;
        type: import(".prisma/client").$Enums.ChatType;
        creatorId: string | null;
    } | null>;
    isChatMember(chatId: string, userId: string): Promise<boolean>;
    usersShareChat(userId: string, otherUserId: string): Promise<boolean>;
    findDirectChatsBetween(userId1: string, userId2: string): Promise<ChatWithUsers[]>;
    mergeDirectChatDuplicates(duplicates: ChatWithUsers[], preferUserId: string): Promise<ChatWithUsers>;
    mergeAllDuplicateDirectChatsForUser(userId: string): Promise<void>;
    createChat(userId1: string, userId2: string): Promise<ChatWithUsers>;
    createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<ChatWithUsers>;
    setChatPinned(chatId: string, userId: string, pinned: boolean): Promise<Date | null>;
    updateLastReadAt(chatId: string, userId: string): Promise<void>;
    updateTimestamp(chatId: string): Promise<void>;
    getChatParticipants(chatId: string): Promise<string[]>;
    getOtherParticipant(chatId: string, userId: string): Promise<string | null>;
}
export declare const chatRepository: ChatRepository;
//# sourceMappingURL=chatRepository.d.ts.map