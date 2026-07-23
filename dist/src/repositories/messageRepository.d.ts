import { Message, MessageStatus } from '@prisma/client';
import { MessageWithSender } from '../types';
declare const ALLOWED_REACTION_EMOJIS: readonly ["❤️", "👍", "😂", "🔥", "😮", "😢"];
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
    softDeleteMessage(messageId: string, senderId: string, chatId: string): Promise<MessageWithSender | null>;
    toggleReaction(input: {
        messageId: string;
        chatId: string;
        userId: string;
        emoji: string;
    }): Promise<{
        message: MessageWithSender;
        added: boolean;
    } | null>;
    updateStatus(messageId: string, status: MessageStatus, readAt?: Date): Promise<Message | null>;
    markAsRead(messageIds: string[], receiverId: string): Promise<number>;
    getReadableMessageIds(messageIds: string[], chatId: string, receiverId: string): Promise<string[]>;
    getMessageForDelivery(messageId: string, chatId: string): Promise<{
        id: string;
        receiverId: string | null;
    } | null>;
    markAsDelivered(chatId: string, receiverId: string): Promise<Message[]>;
    getUnreadCount(chatId: string, userId: string): Promise<number>;
    getLastMessagesForChats(chatIds: string[]): Promise<Map<string, MessageWithSender>>;
}
export declare const messageRepository: MessageRepository;
export { ALLOWED_REACTION_EMOJIS };
//# sourceMappingURL=messageRepository.d.ts.map