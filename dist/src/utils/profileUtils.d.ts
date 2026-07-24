export declare function getAvatarFilePath(avatarUrl: string, uploadsDir?: string): string;
export declare function deleteAvatarFile(avatarUrl: string | null | undefined, uploadsDir?: string): void;
export interface ProfileJson {
    id: string;
    username: string;
    email?: string;
    displayName?: string | null;
    avatar?: string | null;
    bio?: string | null;
    usernameChangeAvailableAt?: string | null;
    birthDate?: string;
    role?: string;
    createdAt: string;
    updatedAt?: string;
    postsCount?: number;
    soundToksCount?: number;
    followersCount?: number;
    followingCount?: number;
    isFollowing?: boolean;
    battleElo?: number;
    battleWins?: number;
    battleLosses?: number;
    battleDraws?: number;
    battleGames?: number;
    rankId?: string;
    rankLabel?: string;
    rankMin?: number;
    rankMax?: number;
    nextRankLabel?: string | null;
    nextRankMin?: number | null;
    progressInRank?: number;
    scaleProgress?: number;
}
export declare function serializeProfile(user: {
    id: string;
    username: string;
    email?: string;
    displayName?: string | null;
    avatar?: string | null;
    bio?: string | null;
    usernameChangedAt?: Date | null;
    birthDate?: Date | null;
    role?: string;
    createdAt: Date;
    updatedAt?: Date;
    battleElo?: number | null;
    battleWins?: number | null;
    battleLosses?: number | null;
    battleDraws?: number | null;
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