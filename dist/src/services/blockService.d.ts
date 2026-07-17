export declare class BlockService {
    block(blockerId: string, blockedId: string): Promise<{
        success: boolean;
        error: string;
    } | {
        success: boolean;
        error?: undefined;
    }>;
    unblock(blockerId: string, blockedId: string): Promise<{
        success: boolean;
    }>;
    isBlockedByMe(blockerId: string, blockedId: string): Promise<boolean>;
    isEitherBlocked(userId1: string, userId2: string): Promise<boolean>;
    getBlockedIds(userId: string): Promise<string[]>;
}
export declare const blockService: BlockService;
//# sourceMappingURL=blockService.d.ts.map