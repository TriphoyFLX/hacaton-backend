"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvatarFilePath = getAvatarFilePath;
exports.deleteAvatarFile = deleteAvatarFile;
exports.serializeProfile = serializeProfile;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const battleRating_1 = require("../services/battleRating");
function getAvatarFilePath(avatarUrl, uploadsDir) {
    const baseDir = uploadsDir ?? path_1.default.join(process.cwd(), 'uploads');
    return path_1.default.join(baseDir, path_1.default.basename(avatarUrl));
}
function deleteAvatarFile(avatarUrl, uploadsDir) {
    if (!avatarUrl)
        return;
    const filePath = getAvatarFilePath(avatarUrl, uploadsDir);
    if (fs_1.default.existsSync(filePath)) {
        fs_1.default.unlinkSync(filePath);
    }
}
function serializeProfile(user, options = {}) {
    const isPrivate = options.visibility !== 'public';
    const rating = (0, battleRating_1.battleRatingPayload)(user);
    const result = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        createdAt: user.createdAt.toISOString(),
        ...rating,
    };
    if (isPrivate && options.includeEmail && user.email) {
        result.email = user.email;
    }
    if (isPrivate && user.birthDate) {
        result.birthDate = user.birthDate.toISOString();
    }
    if (user.role) {
        result.role = user.role;
    }
    if (isPrivate && user.updatedAt) {
        result.updatedAt = user.updatedAt.toISOString();
    }
    if (options.stats) {
        result.postsCount = options.stats.posts;
        result.soundToksCount = options.stats.soundToks;
    }
    if (options.followStats) {
        result.followersCount = options.followStats.followersCount;
        result.followingCount = options.followStats.followingCount;
        if (options.followStats.isFollowing !== undefined) {
            result.isFollowing = options.followStats.isFollowing;
        }
    }
    return result;
}
//# sourceMappingURL=profileUtils.js.map