import { Router, Response, NextFunction } from 'express';
import { createFollowHandlers } from '../controllers/followController';
import { AuthenticatedRequest } from '../types';

type AuthMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export function createFollowRouter(authenticateToken: AuthMiddleware): Router {
  const router = Router();
  const handlers = createFollowHandlers();

  router.get('/following-ids', authenticateToken, handlers.getFollowingIds);
  router.post('/:userId', authenticateToken, handlers.followUser);
  router.delete('/:userId', authenticateToken, handlers.unfollowUser);
  router.get('/:userId/followers', authenticateToken, handlers.getFollowers);
  router.get('/:userId/following', authenticateToken, handlers.getFollowing);

  return router;
}
