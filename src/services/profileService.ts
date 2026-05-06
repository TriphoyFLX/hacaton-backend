import { userRepository, UpdateUserData, UserProfile } from '../repositories/userRepository';
import { z } from 'zod';

// Validation schemas
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

  /**
   * Update user profile with validation
   */
  async updateProfile(
    userId: string,
    data: UpdateUserData
  ): Promise<UpdateProfileResult> {
    const errors: ValidationError[] = [];

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
      const user = await userRepository.updateProfile(userId, data);
      
      if (!user) {
        return { success: false, error: 'Пользователь не найден' };
      }

      return { success: true, user };
    } catch (error) {
      console.error('ProfileService.updateProfile error:', error);
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
