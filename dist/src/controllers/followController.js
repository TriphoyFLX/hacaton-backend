"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFollowHandlers = createFollowHandlers;
const followService_1 = require("../services/followService");
const userRepository_1 = require("../repositories/userRepository");
const notificationService_1 = require("../services/notificationService");
function createFollowHandlers() {
    async function followUser(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { userId } = req.params;
            const result = await followService_1.followService.follow(req.user.id, userId);
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }
            if (result.created) {
                void notificationService_1.notificationService.create({
                    userId,
                    actorId: req.user.id,
                    type: 'FOLLOW',
                    entityType: 'user',
                    entityId: req.user.id,
                }).catch((error) => console.error('Failed to create follow notification:', error));
            }
            res.json(result);
        }
        catch (error) {
            console.error('followUser error:', error);
            res.status(500).json({ error: 'Failed to follow user' });
        }
    }
    async function unfollowUser(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { userId } = req.params;
            const result = await followService_1.followService.unfollow(req.user.id, userId);
            res.json(result);
        }
        catch (error) {
            console.error('unfollowUser error:', error);
            res.status(500).json({ error: 'Failed to unfollow user' });
        }
    }
    async function getFollowingIds(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const ids = await followService_1.followService.getFollowingIds(req.user.id);
            res.json({ ids });
        }
        catch (error) {
            console.error('getFollowingIds error:', error);
            res.status(500).json({ error: 'Failed to fetch following list' });
        }
    }
    async function getFollowers(req, res) {
        try {
            const { userId } = req.params;
            const user = await userRepository_1.userRepository.getUserById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
            const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
            const users = await followService_1.followService.getFollowers(userId, limit, offset);
            res.json(users);
        }
        catch (error) {
            console.error('getFollowers error:', error);
            res.status(500).json({ error: 'Failed to fetch followers' });
        }
    }
    async function getFollowing(req, res) {
        try {
            const { userId } = req.params;
            const user = await userRepository_1.userRepository.getUserById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
            const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
            const users = await followService_1.followService.getFollowing(userId, limit, offset);
            res.json(users);
        }
        catch (error) {
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
//# sourceMappingURL=followController.js.map