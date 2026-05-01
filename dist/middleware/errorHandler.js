"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;
    logger_1.default.error(err);
    if (err.name === 'PrismaClientKnownRequestError') {
        const statusCode = 400;
        const message = 'Database operation failed';
        error = { name: 'DatabaseError', message, statusCode };
    }
    if (err.name === 'PrismaClientValidationError') {
        const statusCode = 400;
        const message = 'Invalid data provided';
        error = { name: 'ValidationError', message, statusCode };
    }
    if (err.name === 'JsonWebTokenError') {
        const statusCode = 401;
        const message = 'Invalid token';
        error = { name: 'JWTError', message, statusCode };
    }
    if (err.name === 'TokenExpiredError') {
        const statusCode = 401;
        const message = 'Token expired';
        error = { name: 'JWTExpiredError', message, statusCode };
    }
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    const response = {
        success: false,
        error: message,
    };
    res.status(statusCode).json(response);
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map