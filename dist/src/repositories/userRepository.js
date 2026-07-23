"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRepository = exports.UserRepository = void 0;
const prisma_1 = require("../lib/prisma");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
class UserRepository {
    async getUserById(id) {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                avatar: true,
                bio: true,
                birthDate: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                battleElo: true,
                battleWins: true,
                battleLosses: true,
                battleDraws: true,
            },
        });
        return user;
    }
    async getUserByEmail(email) {
        return prisma_1.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                username: true,
                email: true,
                password: true,
                role: true,
                createdAt: true,
                displayName: true,
                avatar: true,
                bio: true,
            },
        });
    }
    async updateProfile(userId, data) {
        const updateData = {};
        if (data.displayName !== undefined) {
            updateData.displayName = data.displayName.trim() || null;
        }
        if (data.bio !== undefined) {
            updateData.bio = data.bio.trim() || null;
        }
        if (data.avatar !== undefined) {
            updateData.avatar = data.avatar;
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                avatar: true,
                bio: true,
                birthDate: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return user;
    }
    async updatePassword(userId, newPassword) {
        const hashedPassword = await bcryptjs_1.default.hash(newPassword, 10);
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });
    }
    async isUsernameTaken(username, excludeUserId) {
        const where = { username };
        if (excludeUserId) {
            where.id = { not: excludeUserId };
        }
        const count = await prisma_1.prisma.user.count({ where });
        return count > 0;
    }
    async getUserByUsername(username) {
        return prisma_1.prisma.user.findFirst({
            where: {
                username: { equals: username, mode: 'insensitive' },
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                avatar: true,
                bio: true,
                birthDate: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                battleElo: true,
                battleWins: true,
                battleLosses: true,
                battleDraws: true,
            },
        });
    }
    async getUserStats(userId) {
        const [posts, soundToks] = await Promise.all([
            prisma_1.prisma.post.count({ where: { authorId: userId } }),
            prisma_1.prisma.soundTok.count({ where: { authorId: userId } }),
        ]);
        return { posts, soundToks };
    }
    async searchUsersForProfile(query, limit = 10) {
        return prisma_1.prisma.user.findMany({
            where: {
                OR: [
                    { username: { contains: query, mode: 'insensitive' } },
                    { displayName: { contains: query, mode: 'insensitive' } },
                ],
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                avatar: true,
                bio: true,
                birthDate: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
            take: limit,
            orderBy: { username: 'asc' },
        });
    }
    async searchUsers(query, limit = 10) {
        return prisma_1.prisma.user.findMany({
            where: {
                OR: [
                    { username: { contains: query, mode: 'insensitive' } },
                    { displayName: { contains: query, mode: 'insensitive' } },
                    { email: { contains: query, mode: 'insensitive' } },
                ],
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                avatar: true,
                bio: true,
                birthDate: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
            take: limit,
        });
    }
}
exports.UserRepository = UserRepository;
exports.userRepository = new UserRepository();
//# sourceMappingURL=userRepository.js.map