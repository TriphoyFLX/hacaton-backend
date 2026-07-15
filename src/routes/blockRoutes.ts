import { Router, Response, NextFunction } from 'express';
import { createBlockHandlers } from '../controllers/blockController';
import { AuthenticatedRequest } from '../types';

type AuthMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export function createBlockRouter(authenticateToken: AuthMiddleware): Router {
  const router = Router();
  const handlers = createBlockHandlers();

  router.get('/', authenticateToken, handlers.getBlockedUsers);
  router.get('/check/:userId', authenticateToken, handlers.checkBlockStatus);
  router.post('/:userId', authenticateToken, handlers.blockUser);
  router.delete('/:userId', authenticateToken, handlers.unblockUser);

  return router;
}
