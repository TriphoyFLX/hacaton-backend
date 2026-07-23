import { prisma } from '../lib/prisma';


export interface FollowUserSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  followedAt: string;
}

export class FollowRepository {
  async follow(followerId: string, followingId: string) {
    return prisma.follow.create({
      data: { followerId, followingId },
    });
  }

  async unfollow(followerId: string, followingId: string) {
    return prisma.follow.delete({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const row = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    return !!row;
  }

  async getFollowingIds(followerId: string): Promise<string[]> {
    const rows = await prisma.follow.findMany({
      where: { followerId },
      select: { followingId: true },
    });
    return rows.map((r) => r.followingId);
  }

  async getFollowersCount(userId: string): Promise<number> {
    return prisma.follow.count({ where: { followingId: userId } });
  }

  async getFollowingCount(userId: string): Promise<number> {
    return prisma.follow.count({ where: { followerId: userId } });
  }

  async getFollowers(userId: string, limit = 50, offset = 0): Promise<FollowUserSummary[]> {
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

  async getFollowing(userId: string, limit = 50, offset = 0): Promise<FollowUserSummary[]> {
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

export const followRepository = new FollowRepository();
