export declare function getAvatarFilePath(avatarUrl: string, uploadsDir?: string): string;
export declare function deleteAvatarFile(avatarUrl: string | null | undefined, uploadsDir?: string): void;
export interface ProfileJson {
    id: string;
    username: string;
    email?: string;
    displayName?: string | null;
    avatar?: string | null;
    bio?: string | null;
    birthDate?: string;
    role?: string;
    createdAt: string;
    updatedAt?: string;
    postsCount?: number;
    soundToksCount?: number;
    followersCount?: number;
    followingCount?: number;
    isFollowing?: boolean;
}
export declare function serializeProfile(user: {
    id: string;
    username: string;
    email?: string;
    displayName?: string | null;
    avatar?: string | null;
    bio?: string | null;
    birthDate?: Date | null;
    role?: string;
    createdAt: Date;
    updatedAt?: Date;
}, options?: {
    includeEmail?: boolean;
    stats?: {
        posts: number;
        soundToks: number;
    };
    followStats?: {
        followersCount: number;
        followingCount: number;
        isFollowing?: boolean;
    };
    visibility?: 'public' | 'private';
}): ProfileJson;
//# sourceMappingURL=profileUtils.d.ts.map