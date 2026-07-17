"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBlockRouter = createBlockRouter;
const express_1 = require("express");
const blockController_1 = require("../controllers/blockController");
function createBlockRouter(authenticateToken) {
    const router = (0, express_1.Router)();
    const handlers = (0, blockController_1.createBlockHandlers)();
    router.get('/', authenticateToken, handlers.getBlockedUsers);
    router.get('/check/:userId', authenticateToken, handlers.checkBlockStatus);
    router.post('/:userId', authenticateToken, handlers.blockUser);
    router.delete('/:userId', authenticateToken, handlers.unblockUser);
    return router;
}
//# sourceMappingURL=blockRoutes.js.map