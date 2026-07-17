"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.followRepository = exports.FollowRepository = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
class FollowRepository {
    async follow(followerId, followingId) {
        return prisma.follow.create({
            data: { followerId, followingId },
        });
    }
    async unfollow(followerId, followingId) {
        return prisma.follow.delete({
            where: {
                followerId_followingId: { followerId, followingId },
            },
        });
    }
    async isFollowing(followerId, followingId) {
        const row = await prisma.follow.findUnique({
            where: {
                followerId_followingId: { followerId, followingId },
            },
        });
        return !!row;
    }
    async getFollowingIds(followerId) {
        const rows = await prisma.follow.findMany({
            where: { followerId },
            select: { followingId: true },
        });
        return rows.map((r) => r.followingId);
    }
    async getFollowersCount(userId) {
        return prisma.follow.count({ where: { followingId: userId } });
    }
    async getFollowingCount(userId) {
        return prisma.follow.count({ where: { followerId: userId } });
    }
    async getFollowers(userId, limit = 50, offset = 0) {
        const rows = await prisma.follow.findMany({
            where: { followingId: userId },
            include: {
                follower: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        avatar: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });
        return rows.map((row) => ({
            id: row.follower.id,
            username: row.follower.username,
            displayName: row.follower.displayName,
            avatar: row.follower.avatar,
            followedAt: row.createdAt.toISOString(),
        }));
    }
    async getFollowing(userId, limit = 50, offset = 0) {
        const rows = await prisma.follow.findMany({
            where: { followerId: userId },
            include: {
                following: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        avatar: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });
        return rows.map((row) => ({
            id: row.following.id,
            username: row.following.username,
            displayName: row.following.displayName,
            avatar: row.following.avatar,
            followedAt: row.createdAt.toISOString(),
        }));
    }
}
exports.FollowRepository = FollowRepository;
exports.followRepository = new FollowRepository();
//# sourceMappingURL=followRepository.js.map