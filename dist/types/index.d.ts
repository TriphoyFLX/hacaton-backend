import { Request } from 'express';
import type { User, ProjectStatus, TeamRole, TaskStatus, Priority } from '@prisma/client';
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}
export interface PaginationOptions {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
export interface AuthRequest extends Request {
    user?: User;
}
export interface LoginRequest {
    email: string;
    password: string;
}
export interface RegisterRequest {
    name: string;
    email: string;
    password: string;
}
export interface AuthResponse {
    user: UserWithoutPassword;
    token: string;
}
export type UserWithoutPassword = Omit<User, 'password'>;
export interface CreateUserInput {
    name: string;
    email: string;
    password: string;
}
export interface UpdateUserInput {
    name?: string;
    email?: string;
}
export interface CreateProjectInput {
    name: string;
    description?: string;
    repository?: string;
}
export interface UpdateProjectInput {
    name?: string;
    description?: string;
    repository?: string;
    status?: ProjectStatus;
}
export interface CreateTaskInput {
    title: string;
    description?: string;
    priority?: Priority;
    dueDate?: Date;
    assigneeId?: string;
}
export interface UpdateTaskInput {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: Priority;
    dueDate?: Date;
    assigneeId?: string;
}
export interface AddTeamMemberInput {
    userId: string;
    role: TeamRole;
}
export interface UpdateTeamMemberInput {
    role: TeamRole;
}
export type { User, Project, Task, TeamMember, Session, ProjectStatus, TeamRole, TaskStatus, Priority, } from '@prisma/client';
export interface AppError extends Error {
    statusCode: number;
    isOperational: boolean;
}
export interface ValidationError {
    field: string;
    message: string;
}
export interface JwtPayload {
    userId: string;
    email: string;
    iat: number;
    exp: number;
}
export interface EnvConfig {
    NODE_ENV: string;
    PORT: number;
    DATABASE_URL: string;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    FRONTEND_URL: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: string;
}
//# sourceMappingURL=index.d.ts.map