"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = require("winston");
const { combine, timestamp, errors, json, colorize, simple } = winston_1.format;
const developmentFormat = combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), simple());
const productionFormat = combine(timestamp(), errors({ stack: true }), json());
const logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
    transports: [
        new winston_1.transports.Console(),
        ...(process.env.NODE_ENV === 'production'
            ? [
                new winston_1.transports.File({ filename: 'logs/error.log', level: 'error' }),
                new winston_1.transports.File({ filename: 'logs/combined.log' }),
            ]
            : []),
    ],
    exitOnError: false,
});
exports.default = logger;
//# sourceMappingURL=logger.js.map