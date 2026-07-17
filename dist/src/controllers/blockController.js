"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBlockHandlers = createBlockHandlers;
const blockService_1 = require("../services/blockService");
function createBlockHandlers() {
    async function blockUser(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { userId } = req.params;
            const result = await blockService_1.blockService.block(req.user.id, userId);
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }
            res.json({ success: true });
        }
        catch (error) {
            console.error('blockUser error:', error);
            res.status(500).json({ error: 'Failed to block user' });
        }
    }
    async function unblockUser(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { userId } = req.params;
            await blockService_1.blockService.unblock(req.user.id, userId);
            res.json({ success: true });
        }
        catch (error) {
            console.error('unblockUser error:', error);
            res.status(500).json({ error: 'Failed to unblock user' });
        }
    }
    async function getBlockedUsers(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const ids = await blockService_1.blockService.getBlockedIds(req.user.id);
            res.json({ ids });
        }
        catch (error) {
            console.error('getBlockedUsers error:', error);
            res.status(500).json({ error: 'Failed to fetch blocked users' });
        }
    }
    async function checkBlockStatus(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { userId } = req.params;
            const [blockedByMe, blockedEither] = await Promise.all([
                blockService_1.blockService.isBlockedByMe(req.user.id, userId),
                blockService_1.blockService.isEitherBlocked(req.user.id, userId),
            ]);
            res.json({
                blockedByMe,
                blockedByOther: blockedEither && !blockedByMe,
                isBlocked: blockedEither,
            });
        }
        catch (error) {
            console.error('checkBlockStatus error:', error);
            res.status(500).json({ error: 'Failed to check block status' });
        }
    }
    return {
        blockUser,
        unblockUser,
        getBlockedUsers,
        checkBlockStatus,
    };
}
//# sourceMappingURL=blockController.js.map