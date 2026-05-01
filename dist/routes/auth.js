"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const database_1 = __importDefault(require("../config/database"));
const router = (0, express_1.Router)();
const registerSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters'),
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters'),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(1, 'Password is required'),
});
const generateToken = (userId) => {
    const secret = process.env.JWT_SECRET || 'fallback-secret';
    const payload = { userId };
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    return jsonwebtoken_1.default.sign(payload, secret, { expiresIn });
};
router.post('/register', async (req, res, next) => {
    try {
        const validatedData = registerSchema.parse(req.body);
        const existingUser = await database_1.default.user.findUnique({
            where: { email: validatedData.email },
        });
        if (existingUser) {
            const response = {
                success: false,
                error: 'User with this email already exists',
            };
            return res.status(400).json(response);
        }
        const hashedPassword = await bcryptjs_1.default.hash(validatedData.password, 12);
        const user = await database_1.default.user.create({
            data: {
                name: validatedData.name,
                email: validatedData.email,
                password: hashedPassword,
            },
        });
        const userWithoutPassword = {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
        const token = generateToken(user.id);
        const response = {
            success: true,
            data: {
                user: userWithoutPassword,
                token,
            },
            message: 'User registered successfully',
        };
        return res.status(201).json(response);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const response = {
                success: false,
                error: error.errors[0]?.message || 'Validation failed',
            };
            return res.status(400).json(response);
        }
        next(error);
    }
});
router.post('/login', async (req, res, next) => {
    try {
        const validatedData = loginSchema.parse(req.body);
        const user = await database_1.default.user.findUnique({
            where: { email: validatedData.email },
        });
        if (!user) {
            const response = {
                success: false,
                error: 'Invalid email or password',
            };
            return res.status(401).json(response);
        }
        const isPasswordValid = await bcryptjs_1.default.compare(validatedData.password, user.password);
        if (!isPasswordValid) {
            const response = {
                success: false,
                error: 'Invalid email or password',
            };
            return res.status(401).json(response);
        }
        const userWithoutPassword = {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
        const token = generateToken(user.id);
        const response = {
            success: true,
            data: {
                user: userWithoutPassword,
                token,
            },
            message: 'Login successful',
        };
        return res.json(response);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const response = {
                success: false,
                error: error.errors[0]?.message || 'Validation failed',
            };
            return res.status(400).json(response);
        }
        next(error);
    }
});
router.get('/me', async (req, res, next) => {
    try {
        if (!req.user) {
            const response = {
                success: false,
                error: 'User not authenticated',
            };
            return res.status(401).json(response);
        }
        const response = {
            success: true,
            data: req.user,
        };
        return res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map