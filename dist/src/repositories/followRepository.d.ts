export interface FollowUserSummary {
    id: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    followedAt: string;
}
export declare class FollowRepository {
    follow(followerId: string, followingId: string): Promise<{
        id: string;
        createdAt: Date;
        followerId: string;
        followingId: string;
    }>;
    unfollow(followerId: string, followingId: string): Promise<{
        id: string;
        createdAt: Date;
        followerId: string;
        followingId: string;
    }>;
    isFollowing(followerId: string, followingId: string): Promise<boolean>;
    getFollowingIds(followerId: string): Promise<string[]>;
    getFollowersCount(userId: string): Promise<number>;
    getFollowingCount(userId: string): Promise<number>;
    getFollowers(userId: string, limit?: number, offset?: number): Promise<FollowUserSummary[]>;
    getFollowing(userId: string, limit?: number, offset?: number): Promise<FollowUserSummary[]>;
}
export declare const followRepository: FollowRepository;
//# sourceMappingURL=followRepository.d.ts.map