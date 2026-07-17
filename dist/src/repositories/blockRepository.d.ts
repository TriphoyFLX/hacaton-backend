export declare class BlockRepository {
    blockUser(blockerId: string, blockedId: string): Promise<{
        id: string;
        createdAt: Date;
        blockerId: string;
        blockedId: string;
    }>;
    unblockUser(blockerId: string, blockedId: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    isBlockedBy(blockerId: string, blockedId: string): Promise<boolean>;
    isEitherBlocked(userId1: string, userId2: string): Promise<boolean>;
    getBlockedUserIds(userId: string): Promise<string[]>;
}
export declare const blockRepository: BlockRepository;
//# sourceMappingURL=blockRepository.d.ts.map