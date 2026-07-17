import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
export declare function getIO(): SocketIOServer | null;
export declare function createSocketServer(httpServer: HttpServer): SocketIOServer;
export declare function getUserOnlineStatus(userId: string): boolean;
export declare function getActiveChatUsers(chatId: string): string[];
//# sourceMappingURL=socketServer.d.ts.map