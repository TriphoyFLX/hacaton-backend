import { Response } from 'express';
import fs from 'fs';
import { profileService } from '../services/profileService';
import { userRepository } from '../repositories/userRepository';
import { AuthenticatedRequest } from '../types';
import { deleteAvatarFile, serializeProfile } from '../utils/profileUtils';

export function createProfileHandlers(uploadsDir: string) {
  async function getMyProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const profile = await profileService.getProfile(req.user.id);

      if (!profile) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(serializeProfile(profile, { includeEmail: true, visibility: 'private' }));
    } catch (error) {
      console.error('getMyProfile error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }

  async function getPublicProfile(req: AuthenticatedRequest, res: Response) {
    try {
      const { identifier } = req.params;
      const result = await profileService.getPublicProfile(identifier);

      if (!result) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(
        serializeProfile(result.user, {
          visibility: 'public',
          stats: result.stats,
        })
      );
    } catch (error) {
      console.error('getPublicProfile error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }

  async function updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { displayName, bio } = req.body;

      const result = await profileService.updateProfile(req.user.id, {
        displayName,
        bio,
      });

      if (!result.success) {
        return res.json({
          success: false,
          errors: result.errors,
          error: result.error,
        });
      }

      res.json({
        success: true,
        user: result.user
          ? serializeProfile(result.user, { includeEmail: true, visibility: 'private' })
          : undefined,
      });
    } catch (error) {
      console.error('updateProfile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }

  async function uploadAvatar(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP',
        });
      }

      const maxSize = 5 * 1024 * 1024;
      if (req.file.size > maxSize) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'File too large. Max 5MB' });
      }

      const existing = await userRepository.getUserById(req.user.id);
      if (existing?.avatar) {
        deleteAvatarFile(existing.avatar, uploadsDir);
      }

      const avatarUrl = `/uploads/${req.file.filename}`;

      const result = await profileService.updateProfile(req.user.id, {
        avatar: avatarUrl,
      });

      if (!result.success) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: result.error || 'Failed to update avatar' });
      }

      res.json({ avatar: avatarUrl });
    } catch (error) {
      console.error('uploadAvatar error:', error);
      res.status(500).json({ error: 'Failed to upload avatar' });
    }
  }

  async function deleteAvatarHandler(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await userRepository.getUserById(req.user.id);

      if (user?.avatar) {
        deleteAvatarFile(user.avatar, uploadsDir);
      }

      const result = await profileService.updateProfile(req.user.id, {
        avatar: null,
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ message: 'Avatar deleted' });
    } catch (error) {
      console.error('deleteAvatar error:', error);
      res.status(500).json({ error: 'Failed to delete avatar' });
    }
  }

  async function searchUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const { q, limit = '10' } = req.query;

      if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: 'Query required' });
      }

      const users = await profileService.searchUsersForProfile(
        q,
        parseInt(limit as string, 10)
      );

      const filtered = req.user
        ? users.filter((u) => u.id !== req.user!.id)
        : users;

      res.json(
        filtered.map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          bio: u.bio?.substring(0, 100),
        }))
      );
    } catch (error) {
      console.error('searchUsers error:', error);
      res.status(500).json({ error: 'Failed to search users' });
    }
  }

  return {
    getMyProfile,
    getPublicProfile,
    updateProfile,
    uploadAvatar,
    deleteAvatar: deleteAvatarHandler,
    searchUsers,
  };
}
