"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = __importDefault(require("../config/database"));
const router = (0, express_1.Router)();
router.get('/', async (req, res, next) => {
    try {
        const users = await database_1.default.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        const response = {
            success: true,
            data: users,
        };
        return res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = await database_1.default.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!user) {
            const response = {
                success: false,
                error: 'User not found',
            };
            return res.status(404).json(response);
        }
        const response = {
            success: true,
            data: user,
        };
        return res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.put('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const existingUser = await database_1.default.user.findUnique({
            where: { id },
        });
        if (!existingUser) {
            const response = {
                success: false,
                error: 'User not found',
            };
            return res.status(404).json(response);
        }
        if (updateData.email && updateData.email !== existingUser.email) {
            const emailTaken = await database_1.default.user.findUnique({
                where: { email: updateData.email },
            });
            if (emailTaken) {
                const response = {
                    success: false,
                    error: 'Email is already taken',
                };
                return res.status(400).json(response);
            }
        }
        const updatedUser = await database_1.default.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        const response = {
            success: true,
            data: updatedUser,
            message: 'User updated successfully',
        };
        return res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const existingUser = await database_1.default.user.findUnique({
            where: { id },
        });
        if (!existingUser) {
            const response = {
                success: false,
                error: 'User not found',
            };
            return res.status(404).json(response);
        }
        await database_1.default.user.delete({
            where: { id },
        });
        const response = {
            success: true,
            message: 'User deleted successfully',
        };
        return res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map