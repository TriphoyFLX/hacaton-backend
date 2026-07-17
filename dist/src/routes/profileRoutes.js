"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProfileRouter = createProfileRouter;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const profileController_1 = require("../controllers/profileController");
function createProfileRouter(authenticateToken, uploadsDir) {
    const router = (0, express_1.Router)();
    const handlers = (0, profileController_1.createProfileHandlers)(uploadsDir);
    const avatarUpload = (0, multer_1.default)({
        storage: multer_1.default.diskStorage({
            destination: (_req, _file, cb) => cb(null, uploadsDir),
            filename: (_req, file, cb) => {
                const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                cb(null, uniqueSuffix + path_1.default.extname(file.originalname));
            },
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            const allowed = /jpeg|jpg|png|gif|webp/;
            const extOk = allowed.test(path_1.default.extname(file.originalname).toLowerCase());
            const mimeOk = file.mimetype.startsWith('image/');
            if (extOk || mimeOk) {
                cb(null, true);
            }
            else {
                cb(new Error('Invalid file type. Allowed: JPEG, PNG, GIF, WEBP'));
            }
        },
    });
    const optionalAuth = async (req, res, next) => {
        if (!req.headers.authorization) {
            return next();
        }
        return authenticateToken(req, res, next);
    };
    const handleAvatarUpload = (req, res, next) => {
        avatarUpload.single('avatar')(req, res, (err) => {
            if (err instanceof multer_1.default.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. Max 5MB' });
                }
                return res.status(400).json({ error: err.message });
            }
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            next();
        });
    };
    router.get('/search', optionalAuth, handlers.searchUsers);
    router.get('/', authenticateToken, handlers.getMyProfile);
    router.patch('/', authenticateToken, handlers.updateProfile);
    router.post('/avatar', authenticateToken, handleAvatarUpload, handlers.uploadAvatar);
    router.delete('/avatar', authenticateToken, handlers.deleteAvatar);
    router.get('/:identifier', optionalAuth, handlers.getPublicProfile);
    return router;
}
//# sourceMappingURL=profileRoutes.js.map