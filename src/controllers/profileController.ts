import { Request, Response } from 'express';
import { profileService } from '../services/profileService';
import { userRepository } from '../repositories/userRepository';
import { AuthenticatedRequest } from '../types';
import path from 'path';
import fs from 'fs';

/**
 * Get current user profile
 */
export async function getMyProfile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profile = await profileService.getProfile(req.user.id);

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(profile);
  } catch (error) {
    console.error('getMyProfile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

/**
 * Get public profile by user ID or username
 */
export async function getPublicProfile(req: AuthenticatedRequest, res: Response) {
  try {
    const { identifier } = req.params;

    // Try to find by ID first, then by username
    let user = await userRepository.getUserById(identifier);

    if (!user) {
      // Search by username
      const users = await userRepository.searchUsers(identifier, 1);
      user = users.find(u => u.username.toLowerCase() === identifier.toLowerCase()) || null;
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return public info only
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('getPublicProfile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

/**
 * Update profile
 */
export async function updateProfile(req: AuthenticatedRequest, res: Response) {
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
      if (result.errors) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: result.errors,
        });
      }
      return res.status(400).json({ error: result.error });
    }

    res.json(result.user);
  } catch (error) {
    console.error('updateProfile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
}

/**
 * Upload avatar
 */
export async function uploadAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      // Delete uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP' 
      });
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (req.file.size > maxSize) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File too large. Max 5MB' });
    }

    // Build URL
    const avatarUrl = `/uploads/${req.file.filename}`;

    // Update user avatar
    const result = await profileService.updateProfile(req.user.id, {
      avatar: avatarUrl,
    });

    if (!result.success) {
      // Delete uploaded file on error
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: result.error || 'Failed to update avatar' });
    }

    res.json({ avatar: avatarUrl });
  } catch (error) {
    console.error('uploadAvatar error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
}

/**
 * Delete avatar (reset to default)
 */
export async function deleteAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await userRepository.getUserById(req.user.id);
    
    if (user?.avatar) {
      // Delete old avatar file
      const avatarPath = path.join(__dirname, '../../', user.avatar);
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }

    // Update user to remove avatar
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

/**
 * Search users
 */
export async function searchUsers(req: AuthenticatedRequest, res: Response) {
  try {
    const { q, limit = '10' } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query required' });
    }

    const users = await profileService.searchUsers(q, parseInt(limit as string, 10));

    // If authenticated, exclude self
    const filtered = req.user 
      ? users.filter(u => u.id !== req.user!.id)
      : users;

    res.json(filtered.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      bio: u.bio?.substring(0, 100), // Limit bio in search results
    })));
  } catch (error) {
    console.error('searchUsers error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
}
