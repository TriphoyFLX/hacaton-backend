import { MessageWithSender } from '../types';
import { ChatWithUsers } from '../repositories/chatRepository';
export interface SendMessageResult {
    success: boolean;
    message?: MessageWithSender;
    error?: string;
}
export interface ChatInfo {
    chat: ChatWithUsers;
    messages: MessageWithSender[];
    unreadCount: number;
}
export declare class ChatService {
    sendMessage(data: {
        content: string;
        senderId: string;
        receiverId?: string | null;
        chatId: string;
        clientMessageId: string;
        soundTokId?: string | null;
    }): Promise<SendMessageResult>;
    getChatHistory(chatId: string, userId: string, options?: {
        cursor?: string;
        limit?: number;
    }): Promise<ChatInfo | null>;
    getUserChats(userId: string): Promise<ChatWithUsers[]>;
    createOrGetChat(userId1: string, userId2: string): Promise<ChatWithUsers | null>;
    createGroup(creatorId: string, name: string, memberIds: string[]): Promise<{
        success: boolean;
        chat?: ChatWithUsers;
        error?: string;
    }>;
    togglePin(chatId: string, userId: string, pinned: boolean): Promise<{
        success: boolean;
        pinnedAt: Date | null;
    }>;
    markMessagesAsRead(messageIds: string[], userId: string, chatId: string): Promise<{
        count: number;
        updatedIds: string[];
    }>;
    markChatAsDelivered(chatId: string, userId: string): Promise<string[]>;
    getUnreadCounts(userId: string, chatIds: string[]): Promise<Map<string, number>>;
    private validateMessageIds;
}
export declare const chatService: ChatService;
//# sourceMappingURL=chatService.d.ts.map