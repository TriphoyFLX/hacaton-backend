export declare class FollowService {
    follow(followerId: string, followingId: string): Promise<{
        success: false;
        error: string;
        following?: undefined;
        followersCount?: undefined;
        created?: undefined;
    } | {
        success: true;
        following: boolean;
        followersCount: number;
        created: boolean;
        error?: undefined;
    }>;
    unfollow(followerId: string, followingId: string): Promise<{
        success: true;
        following: boolean;
        followersCount: number;
    }>;
    getFollowingIds(userId: string): Promise<string[]>;
    getFollowStats(userId: string, viewerId?: string): Promise<{
        followersCount: number;
        followingCount: number;
        isFollowing: boolean;
    }>;
    getFollowers(userId: string, limit?: number, offset?: number): Promise<import("../repositories/followRepository").FollowUserSummary[]>;
    getFollowing(userId: string, limit?: number, offset?: number): Promise<import("../repositories/followRepository").FollowUserSummary[]>;
}
export declare const followService: FollowService;
//# sourceMappingURL=followService.d.ts.map