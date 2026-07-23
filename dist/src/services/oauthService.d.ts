export declare function frontendUrl(): string;
export declare function backendUrl(): string;
export declare function oauthState(): string;
export declare function googleAuthUrl(state: string): string;
export declare function exchangeGoogleCode(code: string): Promise<{
    email: string;
    name?: string;
    picture?: string;
    googleId: string;
}>;
export declare function vkAuthUrl(state: string): string;
export declare function exchangeVkCode(code: string): Promise<{
    email: string;
    name?: string;
    picture?: string;
    vkId: string;
}>;
export declare function findOrCreateOAuthUser(input: {
    email: string;
    name?: string;
    picture?: string;
    googleId?: string;
    vkId?: string;
}): Promise<{
    id: string;
    email: string;
    username: string;
    googleId: string | null;
    vkId: string | null;
    password: string | null;
    birthDate: Date;
    agreedToTerms: boolean;
    role: import(".prisma/client").$Enums.Role;
    emailVerified: boolean;
    emailVerificationCode: string | null;
    emailVerificationExpires: Date | null;
    displayName: string | null;
    avatar: string | null;
    bio: string | null;
    plan: import(".prisma/client").$Enums.PlanTier;
    planExpiresAt: Date | null;
    tokenBalance: number;
    midiSavesDayKey: string | null;
    midiSavesToday: number;
    battleElo: number;
    battleWins: number;
    battleLosses: number;
    battleDraws: number;
    createdAt: Date;
    updatedAt: Date;
}>;
//# sourceMappingURL=oauthService.d.ts.map