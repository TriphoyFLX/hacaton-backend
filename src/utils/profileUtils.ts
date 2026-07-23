import path from 'path';
import fs from 'fs';
import { battleRatingPayload } from '../services/battleRating';

export function getAvatarFilePath(avatarUrl: string, uploadsDir?: string): string {
  const baseDir = uploadsDir ?? path.join(process.cwd(), 'uploads');
  return path.join(baseDir, path.basename(avatarUrl));
}

export function deleteAvatarFile(avatarUrl: string | null | undefined, uploadsDir?: string): void {
  if (!avatarUrl) return;

  const filePath = getAvatarFilePath(avatarUrl, uploadsDir);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

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

export function serializeProfile(
  user: {
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
    battleElo?: number | null;
    battleWins?: number | null;
    battleLosses?: number | null;
    battleDraws?: number | null;
  },
  options: {
    includeEmail?: boolean;
    stats?: { posts: number; soundToks: number };
    followStats?: { followersCount: number; followingCount: number; isFollowing?: boolean };
    visibility?: 'public' | 'private';
  } = {}
): ProfileJson {
  const isPrivate = options.visibility !== 'public';
  const rating = battleRatingPayload(user);

  const result: ProfileJson = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
    ...rating,
  };

  if (isPrivate && options.includeEmail && user.email) {
    result.email = user.email;
  }

  if (isPrivate && user.birthDate) {
    result.birthDate = user.birthDate.toISOString();
  }

  if (user.role) {
    result.role = user.role;
  }

  if (isPrivate && user.updatedAt) {
    result.updatedAt = user.updatedAt.toISOString();
  }

  if (options.stats) {
    result.postsCount = options.stats.posts;
    result.soundToksCount = options.stats.soundToks;
  }

  if (options.followStats) {
    result.followersCount = options.followStats.followersCount;
    result.followingCount = options.followStats.followingCount;
    if (options.followStats.isFollowing !== undefined) {
      result.isFollowing = options.followStats.isFollowing;
    }
  }

  return result;
}
