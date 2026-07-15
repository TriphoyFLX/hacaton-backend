import { Response } from 'express';
import { blockService } from '../services/blockService';
import { AuthenticatedRequest } from '../types';

export function createBlockHandlers() {
  async function blockUser(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;
      const result = await blockService.block(req.user.id, userId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('blockUser error:', error);
      res.status(500).json({ error: 'Failed to block user' });
    }
  }

  async function unblockUser(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;
      await blockService.unblock(req.user.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('unblockUser error:', error);
      res.status(500).json({ error: 'Failed to unblock user' });
    }
  }

  async function getBlockedUsers(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const ids = await blockService.getBlockedIds(req.user.id);
      res.json({ ids });
    } catch (error) {
      console.error('getBlockedUsers error:', error);
      res.status(500).json({ error: 'Failed to fetch blocked users' });
    }
  }

  async function checkBlockStatus(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;
      const [blockedByMe, blockedEither] = await Promise.all([
        blockService.isBlockedByMe(req.user.id, userId),
        blockService.isEitherBlocked(req.user.id, userId),
      ]);

      res.json({
        blockedByMe,
        blockedByOther: blockedEither && !blockedByMe,
        isBlocked: blockedEither,
      });
    } catch (error) {
      console.error('checkBlockStatus error:', error);
      res.status(500).json({ error: 'Failed to check block status' });
    }
  }

  return {
    blockUser,
    unblockUser,
    getBlockedUsers,
    checkBlockStatus,
  };
}
