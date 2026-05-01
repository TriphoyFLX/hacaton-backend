"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = __importDefault(require("../config/database"));
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    try {
        await database_1.default.$queryRaw `SELECT 1`;
        const response = {
            success: true,
            data: {
                status: 'OK',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: process.env.NODE_ENV,
                version: process.env.npm_package_version || '1.0.0',
            },
            message: 'Server is running properly',
        };
        res.json(response);
    }
    catch (error) {
        const response = {
            success: false,
            error: 'Database connection failed',
        };
        res.status(500).json(response);
    }
});
exports.default = router;
//# sourceMappingURL=health.js.map