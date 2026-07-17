import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
type AuthMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => void | Promise<void>;
export declare function createBlockRouter(authenticateToken: AuthMiddleware): Router;
export {};
//# sourceMappingURL=blockRoutes.d.ts.map