import { Response } from 'express';
import { followService } from '../services/followService';
import { userRepository } from '../repositories/userRepository';
import { AuthenticatedRequest } from '../types';

export function createFollowHandlers() {
  async function followUser(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;
      const result = await followService.follow(req.user.id, userId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result);
    } catch (error) {
      console.error('followUser error:', error);
      res.status(500).json({ error: 'Failed to follow user' });
    }
  }

  async function unfollowUser(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;
      const result = await followService.unfollow(req.user.id, userId);
      res.json(result);
    } catch (error) {
      console.error('unfollowUser error:', error);
      res.status(500).json({ error: 'Failed to unfollow user' });
    }
  }

  async function getFollowingIds(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const ids = await followService.getFollowingIds(req.user.id);
      res.json({ ids });
    } catch (error) {
      console.error('getFollowingIds error:', error);
      res.status(500).json({ error: 'Failed to fetch following list' });
    }
  }

  async function getFollowers(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;
      const user = await userRepository.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
      const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
      const users = await followService.getFollowers(userId, limit, offset);
      res.json(users);
    } catch (error) {
      console.error('getFollowers error:', error);
      res.status(500).json({ error: 'Failed to fetch followers' });
    }
  }

  async function getFollowing(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;
      const user = await userRepository.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
      const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
      const users = await followService.getFollowing(userId, limit, offset);
      res.json(users);
    } catch (error) {
      console.error('getFollowing error:', error);
      res.status(500).json({ error: 'Failed to fetch following' });
    }
  }

  return {
    followUser,
    unfollowUser,
    getFollowingIds,
    getFollowers,
    getFollowing,
  };
}
