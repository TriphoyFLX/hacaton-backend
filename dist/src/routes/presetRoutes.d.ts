import { PrismaClient } from '@prisma/client';
import { NextFunction, Response, Router } from 'express';
import { AuthenticatedRequest } from '../types';
type AuthMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => void | Promise<void>;
export declare function createPresetRouter(prisma: PrismaClient, authenticateToken: AuthMiddleware, uploadsDir: string, privatePresetsDir: string): Router;
export {};
//# sourceMappingURL=presetRoutes.d.ts.map