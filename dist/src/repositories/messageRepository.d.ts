import { Message, MessageStatus } from '@prisma/client';
import { MessageWithSender } from '../types';
export declare class MessageRepository {
    createMessage(data: {
        content: string;
        senderId: string;
        receiverId?: string | null;
        chatId: string;
        clientMessageId?: string;
        soundTokId?: string | null;
    }): Promise<MessageWithSender | null>;
    getMessagesByChatId(chatId: string, options?: {
        cursor?: string;
        limit?: number;
        before?: Date;
    }): Promise<MessageWithSender[]>;
    updateStatus(messageId: string, status: MessageStatus, readAt?: Date): Promise<Message | null>;
    markAsRead(messageIds: string[], receiverId: string): Promise<number>;
    markAsDelivered(chatId: string, receiverId: string): Promise<Message[]>;
    getUnreadCount(chatId: string, userId: string): Promise<number>;
    getLastMessagesForChats(chatIds: string[]): Promise<Map<string, MessageWithSender>>;
}
export declare const messageRepository: MessageRepository;
//# sourceMappingURL=messageRepository.d.ts.map