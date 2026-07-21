import { followRepository } from '../repositories/followRepository';
import { userRepository } from '../repositories/userRepository';

export class FollowService {
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      return { success: false as const, error: 'Нельзя подписаться на себя' };
    }

    const target = await userRepository.getUserById(followingId);
    if (!target) {
      return { success: false as const, error: 'Пользователь не найден' };
    }

    const already = await followRepository.isFollowing(followerId, followingId);
    if (already) {
      const followersCount = await followRepository.getFollowersCount(followingId);
      return { success: true as const, following: true, followersCount, created: false };
    }

    await followRepository.follow(followerId, followingId);
    const followersCount = await followRepository.getFollowersCount(followingId);

    return { success: true as const, following: true, followersCount, created: true };
  }

  async unfollow(followerId: string, followingId: string) {
    const exists = await followRepository.isFollowing(followerId, followingId);
    if (!exists) {
      const followersCount = await followRepository.getFollowersCount(followingId);
      return { success: true as const, following: false, followersCount };
    }

    await followRepository.unfollow(followerId, followingId);
    const followersCount = await followRepository.getFollowersCount(followingId);

    return { success: true as const, following: false, followersCount };
  }

  async getFollowingIds(userId: string) {
    return followRepository.getFollowingIds(userId);
  }

  async getFollowStats(userId: string, viewerId?: string) {
    const [followersCount, followingCount, isFollowing] = await Promise.all([
      followRepository.getFollowersCount(userId),
      followRepository.getFollowingCount(userId),
      viewerId ? followRepository.isFollowing(viewerId, userId) : Promise.resolve(false),
    ]);

    return { followersCount, followingCount, isFollowing };
  }

  getFollowers(userId: string, limit?: number, offset?: number) {
    return followRepository.getFollowers(userId, limit, offset);
  }

  getFollowing(userId: string, limit?: number, offset?: number) {
    return followRepository.getFollowing(userId, limit, offset);
  }
}

export const followService = new FollowService();
