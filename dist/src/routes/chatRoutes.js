"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChatRouter = createChatRouter;
const express_1 = require("express");
const chatController_1 = require("../controllers/chatController");
function createChatRouter(authenticateToken) {
    const router = (0, express_1.Router)();
    router.get('/', authenticateToken, chatController_1.getChats);
    router.get('/unread/total', authenticateToken, chatController_1.getUnreadTotal);
    router.get('/users/search', authenticateToken, chatController_1.getAvailableUsers);
    router.get('/:chatId/messages', authenticateToken, chatController_1.getMessages);
    router.post('/group', authenticateToken, chatController_1.createGroup);
    router.post('/', authenticateToken, chatController_1.createChat);
    router.patch('/:chatId/pin', authenticateToken, chatController_1.pinChat);
    router.post('/:chatId/messages', authenticateToken, chatController_1.sendMessage);
    router.post('/:chatId/read', authenticateToken, chatController_1.markAsRead);
    return router;
}
//# sourceMappingURL=chatRoutes.js.map