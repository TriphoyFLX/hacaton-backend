import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
type AuthMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => void | Promise<void>;
export declare function createProfileRouter(authenticateToken: AuthMiddleware, uploadsDir: string): Router;
export {};
//# sourceMappingURL=profileRoutes.d.ts.map