import { UpdateUserData, UserProfile } from '../repositories/userRepository';
export interface ValidationError {
    field: string;
    message: string;
}
export interface UpdateProfileResult {
    success: boolean;
    user?: UserProfile;
    errors?: ValidationError[];
    error?: string;
}
export declare class ProfileService {
    getProfile(userId: string): Promise<UserProfile | null>;
    getProfileWithStats(userId: string, viewerId?: string): Promise<{
        user: UserProfile;
        stats: {
            posts: number;
            soundToks: number;
        };
        followStats: {
            followersCount: number;
            followingCount: number;
            isFollowing: boolean;
        };
    } | null>;
    updateProfile(userId: string, data: UpdateUserData): Promise<UpdateProfileResult>;
    updateAvatar(userId: string, avatarPath: string): Promise<UpdateProfileResult>;
    searchUsersForProfile(query: string, limit?: number): Promise<UserProfile[]>;
    getPublicProfile(identifier: string, viewerId?: string): Promise<{
        user: UserProfile;
        stats: {
            posts: number;
            soundToks: number;
        };
        followStats: {
            followersCount: number;
            followingCount: number;
            isFollowing: boolean;
        };
    } | null>;
    searchUsers(query: string, limit?: number): Promise<UserProfile[]>;
    checkUsername(username: string, excludeUserId?: string): Promise<{
        available: boolean;
    }>;
}
export declare const profileService: ProfileService;
//# sourceMappingURL=profileService.d.ts.map