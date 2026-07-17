"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockService = exports.BlockService = void 0;
const blockRepository_1 = require("../repositories/blockRepository");
const userRepository_1 = require("../repositories/userRepository");
class BlockService {
    async block(blockerId, blockedId) {
        if (blockerId === blockedId) {
            return { success: false, error: 'Нельзя заблокировать себя' };
        }
        const user = await userRepository_1.userRepository.getUserById(blockedId);
        if (!user) {
            return { success: false, error: 'Пользователь не найден' };
        }
        await blockRepository_1.blockRepository.blockUser(blockerId, blockedId);
        return { success: true };
    }
    async unblock(blockerId, blockedId) {
        await blockRepository_1.blockRepository.unblockUser(blockerId, blockedId);
        return { success: true };
    }
    async isBlockedByMe(blockerId, blockedId) {
        return blockRepository_1.blockRepository.isBlockedBy(blockerId, blockedId);
    }
    async isEitherBlocked(userId1, userId2) {
        return blockRepository_1.blockRepository.isEitherBlocked(userId1, userId2);
    }
    async getBlockedIds(userId) {
        return blockRepository_1.blockRepository.getBlockedUserIds(userId);
    }
}
exports.BlockService = BlockService;
exports.blockService = new BlockService();
//# sourceMappingURL=blockService.js.map