export interface UserProfile {
    id: string;
    username: string;
    email: string;
    displayName?: string | null;
    avatar?: string | null;
    bio?: string | null;
    birthDate?: Date;
    role: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface UpdateUserData {
    displayName?: string;
    bio?: string;
    avatar?: string | null;
}
export declare class UserRepository {
    getUserById(id: string): Promise<UserProfile | null>;
    getUserByEmail(email: string): Promise<{
        id: string;
        email: string;
        username: string;
        password: string | null;
        role: import(".prisma/client").$Enums.Role;
        displayName: string | null;
        avatar: string | null;
        bio: string | null;
        createdAt: Date;
    } | null>;
    updateProfile(userId: string, data: UpdateUserData): Promise<UserProfile | null>;
    updatePassword(userId: string, newPassword: string): Promise<void>;
    isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean>;
    getUserByUsername(username: string): Promise<UserProfile | null>;
    getUserStats(userId: string): Promise<{
        posts: number;
        soundToks: number;
    }>;
    searchUsersForProfile(query: string, limit?: number): Promise<UserProfile[]>;
    searchUsers(query: string, limit?: number): Promise<UserProfile[]>;
}
export declare const userRepository: UserRepository;
//# sourceMappingURL=userRepository.d.ts.map