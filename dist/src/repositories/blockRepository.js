"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockRepository = exports.BlockRepository = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
class BlockRepository {
    async blockUser(blockerId, blockedId) {
        return prisma.block.upsert({
            where: {
                blockerId_blockedId: { blockerId, blockedId },
            },
            update: {},
            create: { blockerId, blockedId },
        });
    }
    async unblockUser(blockerId, blockedId) {
        return prisma.block.deleteMany({
            where: { blockerId, blockedId },
        });
    }
    async isBlockedBy(blockerId, blockedId) {
        const block = await prisma.block.findUnique({
            where: {
                blockerId_blockedId: { blockerId, blockedId },
            },
        });
        return !!block;
    }
    async isEitherBlocked(userId1, userId2) {
        const block = await prisma.block.findFirst({
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
        const blocks = await prisma.block.findMany({
            where: { blockerId: userId },
            select: { blockedId: true },
        });
        return blocks.map(b => b.blockedId);
    }
}
exports.BlockRepository = BlockRepository;
exports.blockRepository = new BlockRepository();
//# sourceMappingURL=blockRepository.js.map