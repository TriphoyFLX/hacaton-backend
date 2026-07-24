import { userRepository, UpdateUserData, UserProfile } from '../repositories/userRepository';
import { followService } from './followService';
import { z } from 'zod';

// Validation schemas
const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Юзернейм должен содержать минимум 3 символа')
  .max(30, 'Юзернейм должен быть не длиннее 30 символов')
  .regex(/^[a-zA-Z0-9_]+$/, 'Используйте только латинские буквы, цифры и _');

const displayNameSchema = z
  .string()
  .min(1, 'Имя слишком короткое')
  .max(50, 'Имя должно быть не длиннее 50 символов')
  .regex(/^[\p{L}\p{N}\s._-]+$/u, 'Имя содержит недопустимые символы');

const bioSchema = z
  .string()
  .max(500, 'Описание должно быть не длиннее 500 символов');

const avatarSchema = z
  .string()
  .regex(/^\/uploads\//, 'Некорректный путь к аватару')
  .max(500, 'Путь к аватару слишком длинный');

const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

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

export class ProfileService {
  /**
   * Get user profile
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    return userRepository.getUserById(userId);
  }

  async getProfileWithStats(userId: string, viewerId?: string) {
    const user = await userRepository.getUserById(userId);
    if (!user) return null;

    const [stats, followStats] = await Promise.all([
      userRepository.getUserStats(userId),
      followService.getFollowStats(userId, viewerId),
    ]);

    return { user, stats, followStats };
  }

  /**
   * Update user profile with validation
   */
  async updateProfile(
    userId: string,
    data: UpdateUserData
  ): Promise<UpdateProfileResult> {
    const errors: ValidationError[] = [];
    const updateData: UpdateUserData = { ...data };

    if (data.username !== undefined) {
      const normalizedUsername = data.username.trim();
      const result = usernameSchema.safeParse(normalizedUsername);
      if (!result.success) {
        errors.push({
          field: 'username',
          message: result.error.errors[0]?.message || 'Некорректный юзернейм',
        });
      } else {
        const currentUser = await userRepository.getUserById(userId);
        if (!currentUser) {
          return { success: false, error: 'Пользователь не найден' };
        }

        if (normalizedUsername.toLowerCase() === currentUser.username.toLowerCase()) {
          delete updateData.username;
        } else {
          if (currentUser.usernameChangedAt) {
            const nextChangeAt = new Date(
              currentUser.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS,
            );
            if (nextChangeAt.getTime() > Date.now()) {
              errors.push({
                field: 'username',
                message: `Следующая смена доступна ${nextChangeAt.toLocaleDateString('ru-RU')}`,
              });
            }
          }

          if (!errors.some((item) => item.field === 'username')) {
            const isTaken = await userRepository.isUsernameTaken(normalizedUsername, userId);
            if (isTaken) {
              errors.push({ field: 'username', message: 'Этот юзернейм уже занят' });
            } else {
              updateData.username = normalizedUsername;
            }
          }
        }
      }
    }

    // Validate displayName
    if (data.displayName !== undefined) {
      const result = displayNameSchema.safeParse(data.displayName);
      if (!result.success) {
        errors.push({
          field: 'displayName',
          message: result.error.errors[0]?.message || 'Некорректное имя',
        });
      }
    }

    // Validate bio
    if (data.bio !== undefined) {
      const result = bioSchema.safeParse(data.bio);
      if (!result.success) {
        errors.push({
          field: 'bio',
          message: result.error.errors[0]?.message || 'Некорректное описание',
        });
      }
    }

    // Validate avatar
    if (data.avatar !== undefined && data.avatar !== null) {
      const result = avatarSchema.safeParse(data.avatar);
      if (!result.success) {
        errors.push({
          field: 'avatar',
          message: result.error.errors[0]?.message || 'Некорректный аватар',
        });
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    try {
      const user = await userRepository.updateProfile(userId, updateData);
      
      if (!user) {
        return { success: false, error: 'Пользователь не найден' };
      }

      return { success: true, user };
    } catch (error) {
      console.error('ProfileService.updateProfile error:', error);
      if ((error as { code?: string }).code === 'P2002') {
        return {
          success: false,
          errors: [{ field: 'username', message: 'Этот юзернейм уже занят' }],
        };
      }
      return { success: false, error: 'Ошибка при обновлении профиля' };
    }
  }

  /**
   * Update avatar path
   */
  async updateAvatar(userId: string, avatarPath: string): Promise<UpdateProfileResult> {
    const result = avatarSchema.safeParse(avatarPath);
    
    if (!result.success) {
      return {
        success: false,
        errors: [{
          field: 'avatar',
          message: result.error.errors[0]?.message || 'Некорректный путь',
        }],
      };
    }

    return this.updateProfile(userId, { avatar: avatarPath });
  }

  /**
   * Search users for profile page
   */
  async searchUsersForProfile(query: string, limit: number = 10): Promise<UserProfile[]> {
    if (!query.trim() || query.length < 2) {
      return [];
    }

    return userRepository.searchUsersForProfile(query.trim(), limit);
  }

  /**
   * Get public profile by id or username
   */
  async getPublicProfile(identifier: string, viewerId?: string): Promise<{
    user: UserProfile;
    stats: { posts: number; soundToks: number; likedSoundToks: number };
    followStats: { followersCount: number; followingCount: number; isFollowing: boolean };
  } | null> {
    let user = await userRepository.getUserById(identifier);

    if (!user) {
      user = await userRepository.getUserByUsername(identifier);
    }

    if (!user) {
      return null;
    }

    const [stats, followStats] = await Promise.all([
      userRepository.getUserStats(user.id),
      followService.getFollowStats(user.id, viewerId),
    ]);

    return { user, stats, followStats };
  }

  private async resolveProfileUser(identifier: string): Promise<UserProfile | null> {
    let user = await userRepository.getUserById(identifier);
    if (!user) {
      user = await userRepository.getUserByUsername(identifier);
    }
    return user;
  }

  /**
   * SoundToks authored by profile user
   */
  async getProfileSoundToks(
    identifier: string,
    opts: { limit?: number; offset?: number; viewerId?: string } = {}
  ) {
    const user = await this.resolveProfileUser(identifier);
    if (!user) return null;
    const page = await userRepository.getUserSoundToks(user.id, opts);
    return { userId: user.id, ...page };
  }

  /**
   * Liked SoundToks — owner always; others only if public
   */
  async getProfileLikedSoundToks(
    identifier: string,
    opts: { limit?: number; offset?: number; viewerId?: string } = {}
  ): Promise<
    | { forbidden: true; private: true }
    | { userId: string; items: unknown[]; total: number; limit: number; offset: number; hasMore: boolean }
    | null
  > {
    const user = await this.resolveProfileUser(identifier);
    if (!user) return null;

    const isOwner = Boolean(opts.viewerId && opts.viewerId === user.id);
    if (!isOwner && !user.likedSoundToksPublic) {
      return { forbidden: true, private: true };
    }

    const page = await userRepository.getUserLikedSoundToks(user.id, opts);
    return { userId: user.id, ...page };
  }

  /**
   * Search users
   */
  async searchUsers(query: string, limit: number = 10): Promise<UserProfile[]> {
    if (!query.trim() || query.length < 2) {
      return [];
    }

    return userRepository.searchUsers(query.trim(), limit);
  }

  /**
   * Check username availability
   */
  async checkUsername(username: string, excludeUserId?: string): Promise<{ available: boolean }> {
    const isTaken = await userRepository.isUsernameTaken(username, excludeUserId);
    return { available: !isTaken };
  }
}

export const profileService = new ProfileService();
