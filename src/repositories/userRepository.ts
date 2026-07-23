import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';


export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
  birthDate?: Date;
  role: string;
  emailVerified?: boolean;
  createdAt: Date;
  updatedAt: Date;
  battleElo?: number;
  battleWins?: number;
  battleLosses?: number;
  battleDraws?: number;
}

export interface UpdateUserData {
  displayName?: string;
  bio?: string;
  avatar?: string | null;
}

export class UserRepository {
  /**
   * Get user by ID with profile fields
   */
  async getUserById(id: string): Promise<UserProfile | null> {
    const user = await prisma.user.findUnique({
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
        emailVerified: true,
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

  /**
   * Get user by email
   */
  async getUserByEmail(email: string) {
    return prisma.user.findUnique({
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

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: UpdateUserData): Promise<UserProfile | null> {
    const updateData: any = {};

    if (data.displayName !== undefined) {
      updateData.displayName = data.displayName.trim() || null;
    }
    
    if (data.bio !== undefined) {
      updateData.bio = data.bio.trim() || null;
    }
    
    if (data.avatar !== undefined) {
      updateData.avatar = data.avatar;
    }

    const user = await prisma.user.update({
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

  /**
   * Update password
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  /**
   * Check if username is taken (excluding current user)
   */
  async isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
    const where: any = { username };
    
    if (excludeUserId) {
      where.id = { not: excludeUserId };
    }

    const count = await prisma.user.count({ where });
    return count > 0;
  }

  /**
   * Get user by username (case-insensitive)
   */
  async getUserByUsername(username: string): Promise<UserProfile | null> {
    return prisma.user.findFirst({
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

  /**
   * Get public stats for a user profile
   */
  async getUserStats(userId: string): Promise<{ posts: number; soundToks: number }> {
    const [posts, soundToks] = await Promise.all([
      prisma.post.count({ where: { authorId: userId } }),
      prisma.soundTok.count({ where: { authorId: userId } }),
    ]);

    return { posts, soundToks };
  }

  /**
   * Search users for profile discovery (no email in results)
   */
  async searchUsersForProfile(query: string, limit: number = 10): Promise<UserProfile[]> {
    return prisma.user.findMany({
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

  /**
   * Search users
   */
  async searchUsers(query: string, limit: number = 10): Promise<UserProfile[]> {
    return prisma.user.findMany({
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

export const userRepository = new UserRepository();
