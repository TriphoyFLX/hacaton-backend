import { Router } from 'express';
import { AuthenticatedRequest } from '../types';
type AuthMiddleware = (req: AuthenticatedRequest, res: any, next: any) => void | Promise<void>;
export declare function createChatRouter(authenticateToken: AuthMiddleware): Router;
export {};
//# sourceMappingURL=chatRoutes.d.ts.map