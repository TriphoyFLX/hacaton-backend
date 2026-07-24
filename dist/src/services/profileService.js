"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileService = exports.ProfileService = void 0;
const userRepository_1 = require("../repositories/userRepository");
const followService_1 = require("./followService");
const zod_1 = require("zod");
const usernameSchema = zod_1.z
    .string()
    .trim()
    .min(3, 'Юзернейм должен содержать минимум 3 символа')
    .max(30, 'Юзернейм должен быть не длиннее 30 символов')
    .regex(/^[a-zA-Z0-9_]+$/, 'Используйте только латинские буквы, цифры и _');
const displayNameSchema = zod_1.z
    .string()
    .min(1, 'Имя слишком короткое')
    .max(50, 'Имя должно быть не длиннее 50 символов')
    .regex(/^[\p{L}\p{N}\s._-]+$/u, 'Имя содержит недопустимые символы');
const bioSchema = zod_1.z
    .string()
    .max(500, 'Описание должно быть не длиннее 500 символов');
const avatarSchema = zod_1.z
    .string()
    .regex(/^\/uploads\//, 'Некорректный путь к аватару')
    .max(500, 'Путь к аватару слишком длинный');
const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
class ProfileService {
    async getProfile(userId) {
        return userRepository_1.userRepository.getUserById(userId);
    }
    async getProfileWithStats(userId, viewerId) {
        const user = await userRepository_1.userRepository.getUserById(userId);
        if (!user)
            return null;
        const [stats, followStats] = await Promise.all([
            userRepository_1.userRepository.getUserStats(userId),
            followService_1.followService.getFollowStats(userId, viewerId),
        ]);
        return { user, stats, followStats };
    }
    async updateProfile(userId, data) {
        const errors = [];
        const updateData = { ...data };
        if (data.username !== undefined) {
            const normalizedUsername = data.username.trim();
            const result = usernameSchema.safeParse(normalizedUsername);
            if (!result.success) {
                errors.push({
                    field: 'username',
                    message: result.error.errors[0]?.message || 'Некорректный юзернейм',
                });
            }
            else {
                const currentUser = await userRepository_1.userRepository.getUserById(userId);
                if (!currentUser) {
                    return { success: false, error: 'Пользователь не найден' };
                }
                if (normalizedUsername.toLowerCase() === currentUser.username.toLowerCase()) {
                    delete updateData.username;
                }
                else {
                    if (currentUser.usernameChangedAt) {
                        const nextChangeAt = new Date(currentUser.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS);
                        if (nextChangeAt.getTime() > Date.now()) {
                            errors.push({
                                field: 'username',
                                message: `Следующая смена доступна ${nextChangeAt.toLocaleDateString('ru-RU')}`,
                            });
                        }
                    }
                    if (!errors.some((item) => item.field === 'username')) {
                        const isTaken = await userRepository_1.userRepository.isUsernameTaken(normalizedUsername, userId);
                        if (isTaken) {
                            errors.push({ field: 'username', message: 'Этот юзернейм уже занят' });
                        }
                        else {
                            updateData.username = normalizedUsername;
                        }
                    }
                }
            }
        }
        if (data.displayName !== undefined) {
            const result = displayNameSchema.safeParse(data.displayName);
            if (!result.success) {
                errors.push({
                    field: 'displayName',
                    message: result.error.errors[0]?.message || 'Некорректное имя',
                });
            }
        }
        if (data.bio !== undefined) {
            const result = bioSchema.safeParse(data.bio);
            if (!result.success) {
                errors.push({
                    field: 'bio',
                    message: result.error.errors[0]?.message || 'Некорректное описание',
                });
            }
        }
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
            const user = await userRepository_1.userRepository.updateProfile(userId, updateData);
            if (!user) {
                return { success: false, error: 'Пользователь не найден' };
            }
            return { success: true, user };
        }
        catch (error) {
            console.error('ProfileService.updateProfile error:', error);
            if (error.code === 'P2002') {
                return {
                    success: false,
                    errors: [{ field: 'username', message: 'Этот юзернейм уже занят' }],
                };
            }
            return { success: false, error: 'Ошибка при обновлении профиля' };
        }
    }
    async updateAvatar(userId, avatarPath) {
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
    async searchUsersForProfile(query, limit = 10) {
        if (!query.trim() || query.length < 2) {
            return [];
        }
        return userRepository_1.userRepository.searchUsersForProfile(query.trim(), limit);
    }
    async getPublicProfile(identifier, viewerId) {
        let user = await userRepository_1.userRepository.getUserById(identifier);
        if (!user) {
            user = await userRepository_1.userRepository.getUserByUsername(identifier);
        }
        if (!user) {
            return null;
        }
        const [stats, followStats] = await Promise.all([
            userRepository_1.userRepository.getUserStats(user.id),
            followService_1.followService.getFollowStats(user.id, viewerId),
        ]);
        return { user, stats, followStats };
    }
    async searchUsers(query, limit = 10) {
        if (!query.trim() || query.length < 2) {
            return [];
        }
        return userRepository_1.userRepository.searchUsers(query.trim(), limit);
    }
    async checkUsername(username, excludeUserId) {
        const isTaken = await userRepository_1.userRepository.isUsernameTaken(username, excludeUserId);
        return { available: !isTaken };
    }
}
exports.ProfileService = ProfileService;
exports.profileService = new ProfileService();
//# sourceMappingURL=profileService.js.map