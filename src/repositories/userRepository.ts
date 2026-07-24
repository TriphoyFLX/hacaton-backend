import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';


export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
  usernameChangedAt?: Date | null;
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
  username?: string;
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
        usernameChangedAt: true,
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

    if (data.username !== undefined) {
      updateData.username = data.username;
      updateData.usernameChangedAt = new Date();
    }

    if (data.displayName !== undefined) {
      updateData.displayName = data.displayName.trim() || null;
    }
    
    if (data.bio !== undefined) {
      updateData.bio = data.bio.trim() || null;
    }
    
    if (data.avatar !== undefined) {
      updateData.avatar = data.avatar;
    }

    const profileSelect = {
      id: true,
      username: true,
      email: true,
      displayName: true,
      avatar: true,
      bio: true,
      usernameChangedAt: true,
      birthDate: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    if (data.username !== undefined) {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      if (!current) return null;

      if (current.username.toLowerCase() !== data.username.toLowerCase()) {
        const user = await prisma.$transaction(async (tx) => {
          await tx.usernameHistory.upsert({
            where: { username: current.username },
            create: { userId, username: current.username },
            update: { userId },
          });
          // Drop history row if user reclaims a previous name of theirs
          await tx.usernameHistory.deleteMany({
            where: {
              userId,
              username: { equals: data.username, mode: 'insensitive' },
            },
          });
          return tx.user.update({
            where: { id: userId },
            data: updateData,
            select: profileSelect,
          });
        });
        return user;
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: profileSelect,
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
    const [activeCount, historyCount] = await Promise.all([
      prisma.user.count({
        where: {
          username: { equals: username, mode: 'insensitive' },
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
      }),
      prisma.usernameHistory.count({
        where: {
          username: { equals: username, mode: 'insensitive' },
          ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
      }),
    ]);

    return activeCount > 0 || historyCount > 0;
  }

  /**
   * Get user by username (case-insensitive), including previous usernames
   */
  async getUserByUsername(username: string): Promise<UserProfile | null> {
    const profileSelect = {
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
      usernameChangedAt: true,
    } as const;

    const direct = await prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
      },
      select: profileSelect,
    });
    if (direct) return direct;

    const historical = await prisma.usernameHistory.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
      },
      select: { userId: true },
    });
    if (!historical) return null;

    return prisma.user.findUnique({
      where: { id: historical.userId },
      select: profileSelect,
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
          { usernameHistory: { some: { username: { contains: query, mode: 'insensitive' } } } },
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
          { usernameHistory: { some: { username: { contains: query, mode: 'insensitive' } } } },
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
