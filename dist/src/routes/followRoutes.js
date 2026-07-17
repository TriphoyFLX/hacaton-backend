"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFollowRouter = createFollowRouter;
const express_1 = require("express");
const followController_1 = require("../controllers/followController");
function createFollowRouter(authenticateToken) {
    const router = (0, express_1.Router)();
    const handlers = (0, followController_1.createFollowHandlers)();
    router.get('/following-ids', authenticateToken, handlers.getFollowingIds);
    router.post('/:userId', authenticateToken, handlers.followUser);
    router.delete('/:userId', authenticateToken, handlers.unfollowUser);
    router.get('/:userId/followers', authenticateToken, handlers.getFollowers);
    router.get('/:userId/following', authenticateToken, handlers.getFollowing);
    return router;
}
//# sourceMappingURL=followRoutes.js.map