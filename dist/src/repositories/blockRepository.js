"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockRepository = exports.BlockRepository = void 0;
const prisma_1 = require("../lib/prisma");
class BlockRepository {
    async blockUser(blockerId, blockedId) {
        return prisma_1.prisma.block.upsert({
            where: {
                blockerId_blockedId: { blockerId, blockedId },
            },
            update: {},
            create: { blockerId, blockedId },
        });
    }
    async unblockUser(blockerId, blockedId) {
        return prisma_1.prisma.block.deleteMany({
            where: { blockerId, blockedId },
        });
    }
    async isBlockedBy(blockerId, blockedId) {
        const block = await prisma_1.prisma.block.findUnique({
            where: {
                blockerId_blockedId: { blockerId, blockedId },
            },
        });
        return !!block;
    }
    async isEitherBlocked(userId1, userId2) {
        const block = await prisma_1.prisma.block.findFirst({
            where: {
                OR: [
                    { blockerId: userId1, blockedId: userId2 },
                    { blockerId: userId2, blockedId: userId1 },
                ],
            },
        });
        return !!block;
    }
    async getBlockedUserIds(userId) {
        const blocks = await prisma_1.prisma.block.findMany({
            where: { blockerId: userId },
            select: { blockedId: true },
        });
        return blocks.map(b => b.blockedId);
    }
}
exports.BlockRepository = BlockRepository;
exports.blockRepository = new BlockRepository();
//# sourceMappingURL=blockRepository.js.map