"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.followService = exports.FollowService = void 0;
const followRepository_1 = require("../repositories/followRepository");
const userRepository_1 = require("../repositories/userRepository");
class FollowService {
    async follow(followerId, followingId) {
        if (followerId === followingId) {
            return { success: false, error: 'Нельзя подписаться на себя' };
        }
        const target = await userRepository_1.userRepository.getUserById(followingId);
        if (!target) {
            return { success: false, error: 'Пользователь не найден' };
        }
        const already = await followRepository_1.followRepository.isFollowing(followerId, followingId);
        if (already) {
            const followersCount = await followRepository_1.followRepository.getFollowersCount(followingId);
            return { success: true, following: true, followersCount };
        }
        await followRepository_1.followRepository.follow(followerId, followingId);
        const followersCount = await followRepository_1.followRepository.getFollowersCount(followingId);
        return { success: true, following: true, followersCount };
    }
    async unfollow(followerId, followingId) {
        const exists = await followRepository_1.followRepository.isFollowing(followerId, followingId);
        if (!exists) {
            const followersCount = await followRepository_1.followRepository.getFollowersCount(followingId);
            return { success: true, following: false, followersCount };
        }
        await followRepository_1.followRepository.unfollow(followerId, followingId);
        const followersCount = await followRepository_1.followRepository.getFollowersCount(followingId);
        return { success: true, following: false, followersCount };
    }
    async getFollowingIds(userId) {
        return followRepository_1.followRepository.getFollowingIds(userId);
    }
    async getFollowStats(userId, viewerId) {
        const [followersCount, followingCount, isFollowing] = await Promise.all([
            followRepository_1.followRepository.getFollowersCount(userId),
            followRepository_1.followRepository.getFollowingCount(userId),
            viewerId ? followRepository_1.followRepository.isFollowing(viewerId, userId) : Promise.resolve(false),
        ]);
        return { followersCount, followingCount, isFollowing };
    }
    getFollowers(userId, limit, offset) {
        return followRepository_1.followRepository.getFollowers(userId, limit, offset);
    }
    getFollowing(userId, limit, offset) {
        return followRepository_1.followRepository.getFollowing(userId, limit, offset);
    }
}
exports.FollowService = FollowService;
exports.followService = new FollowService();
//# sourceMappingURL=followService.js.map