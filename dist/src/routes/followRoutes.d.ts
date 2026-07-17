import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
type AuthMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => void | Promise<void>;
export declare function createFollowRouter(authenticateToken: AuthMiddleware): Router;
export {};
//# sourceMappingURL=followRoutes.d.ts.map