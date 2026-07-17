import { Request } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        username: string;
        email: string;
        role: string;
        createdAt: Date;
    };
}
export interface TokenPayload {
    userId: string;
    role: string;
}
export interface ServerToClientEvents {
    'message:new': (message: MessageWithSender) => void;
    'message:status': (data: {
        messageId: string;
        status: string;
        readAt?: Date;
    }) => void;
    'message:delivered': (data: {
        clientMessageId: string;
        messageId: string;
    }) => void;
    'chat:typing': (data: {
        chatId: string;
        userId: string;
        isTyping: boolean;
    }) => void;
    'chat:presence': (data: {
        chatId: string;
        userId: string;
        isOnline: boolean;
    }) => void;
    'user:online': (data: {
        userId: string;
        isOnline: boolean;
    }) => void;
    'error': (error: {
        message: string;
        code: string;
    }) => void;
}
export interface ClientToServerEvents {
    'message:send': (data: SendMessageData, callback: (response: MessageResponse) => void) => void;
    'message:read': (data: {
        messageIds: string[];
        chatId: string;
    }) => void;
    'message:deliver': (data: {
        messageId: string;
        chatId: string;
    }) => void;
    'chat:join': (chatId: string) => void;
    'chat:leave': (chatId: string) => void;
    'chat:typing': (data: {
        chatId: string;
        isTyping: boolean;
    }) => void;
    'user:subscribe': (userId: string) => void;
}
export interface InterServerEvents {
    ping: () => void;
}
export interface SocketData {
    userId: string;
    username: string;
}
export interface SharedSoundTokPreview {
    id: string;
    description: string;
    videoUrl: string;
    authorId: string;
    author: {
        id: string;
        username: string;
        displayName?: string | null;
        avatar?: string | null;
    };
}
export interface MessageWithSender {
    id: string;
    content: string;
    senderId: string;
    receiverId?: string | null;
    chatId: string;
    soundTokId?: string | null;
    clientMessageId?: string | null;
    status: 'SENT' | 'DELIVERED' | 'READ';
    readAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    sender: {
        id: string;
        username: string;
        displayName?: string | null;
        avatar?: string | null;
    };
    soundTok?: SharedSoundTokPreview | null;
}
export interface SendMessageData {
    content: string;
    chatId: string;
    clientMessageId: string;
    receiverId?: string;
    soundTokId?: string;
}
export interface MessageResponse {
    success: boolean;
    message?: MessageWithSender;
    error?: string;
    clientMessageId?: string;
}
export interface UpdateProfileData {
    displayName?: string;
    bio?: string;
}
export interface ProfileResponse {
    id: string;
    username: string;
    email: string;
    displayName?: string | null;
    avatar?: string | null;
    bio?: string | null;
    birthDate?: Date;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=index.d.ts.map