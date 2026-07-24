"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProfileHandlers = createProfileHandlers;
const fs_1 = __importDefault(require("fs"));
const profileService_1 = require("../services/profileService");
const userRepository_1 = require("../repositories/userRepository");
const profileUtils_1 = require("../utils/profileUtils");
function createProfileHandlers(uploadsDir) {
    async function getMyProfile(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const profile = await profileService_1.profileService.getProfileWithStats(req.user.id, req.user.id);
            if (!profile) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json((0, profileUtils_1.serializeProfile)(profile.user, {
                includeEmail: true,
                visibility: 'private',
                stats: profile.stats,
                followStats: { ...profile.followStats, isFollowing: false },
            }));
        }
        catch (error) {
            console.error('getMyProfile error:', error);
            res.status(500).json({ error: 'Failed to fetch profile' });
        }
    }
    async function getPublicProfile(req, res) {
        try {
            const { identifier } = req.params;
            const result = await profileService_1.profileService.getPublicProfile(identifier, req.user?.id);
            if (!result) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json((0, profileUtils_1.serializeProfile)(result.user, {
                visibility: 'public',
                stats: result.stats,
                followStats: result.followStats,
            }));
        }
        catch (error) {
            console.error('getPublicProfile error:', error);
            res.status(500).json({ error: 'Failed to fetch profile' });
        }
    }
    async function updateProfile(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { username, displayName, bio } = req.body;
            const result = await profileService_1.profileService.updateProfile(req.user.id, {
                username,
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
                    ? (0, profileUtils_1.serializeProfile)(result.user, { includeEmail: true, visibility: 'private' })
                    : undefined,
            });
        }
        catch (error) {
            console.error('updateProfile error:', error);
            res.status(500).json({ error: 'Failed to update profile' });
        }
    }
    async function uploadAvatar(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                fs_1.default.unlinkSync(req.file.path);
                return res.status(400).json({
                    error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP',
                });
            }
            const maxSize = 5 * 1024 * 1024;
            if (req.file.size > maxSize) {
                fs_1.default.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'File too large. Max 5MB' });
            }
            const existing = await userRepository_1.userRepository.getUserById(req.user.id);
            if (existing?.avatar) {
                (0, profileUtils_1.deleteAvatarFile)(existing.avatar, uploadsDir);
            }
            const avatarUrl = `/uploads/${req.file.filename}`;
            const result = await profileService_1.profileService.updateProfile(req.user.id, {
                avatar: avatarUrl,
            });
            if (!result.success) {
                fs_1.default.unlinkSync(req.file.path);
                return res.status(400).json({ error: result.error || 'Failed to update avatar' });
            }
            res.json({ avatar: avatarUrl });
        }
        catch (error) {
            console.error('uploadAvatar error:', error);
            res.status(500).json({ error: 'Failed to upload avatar' });
        }
    }
    async function deleteAvatarHandler(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const user = await userRepository_1.userRepository.getUserById(req.user.id);
            if (user?.avatar) {
                (0, profileUtils_1.deleteAvatarFile)(user.avatar, uploadsDir);
            }
            const result = await profileService_1.profileService.updateProfile(req.user.id, {
                avatar: null,
            });
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }
            res.json({ message: 'Avatar deleted' });
        }
        catch (error) {
            console.error('deleteAvatar error:', error);
            res.status(500).json({ error: 'Failed to delete avatar' });
        }
    }
    async function searchUsers(req, res) {
        try {
            const { q, limit = '10' } = req.query;
            if (!q || typeof q !== 'string') {
                return res.status(400).json({ error: 'Query required' });
            }
            const users = await profileService_1.profileService.searchUsersForProfile(q, parseInt(limit, 10));
            const filtered = req.user
                ? users.filter((u) => u.id !== req.user.id)
                : users;
            res.json(filtered.map((u) => ({
                id: u.id,
                username: u.username,
                displayName: u.displayName,
                avatar: u.avatar,
                bio: u.bio?.substring(0, 100),
            })));
        }
        catch (error) {
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
//# sourceMappingURL=profileController.js.map