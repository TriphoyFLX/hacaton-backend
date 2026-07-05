import path from 'path';
import fs from 'fs';

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
  },
  options: {
    includeEmail?: boolean;
    stats?: { posts: number; soundToks: number };
    followStats?: { followersCount: number; followingCount: number; isFollowing?: boolean };
    visibility?: 'public' | 'private';
  } = {}
): ProfileJson {
  const isPrivate = options.visibility !== 'public';

  const result: ProfileJson = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  };

  if (isPrivate && options.includeEmail && user.email) {
    result.email = user.email;
  }

  if (isPrivate && user.birthDate) {
    result.birthDate = user.birthDate.toISOString();
  }

  if (isPrivate && user.role) {
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
