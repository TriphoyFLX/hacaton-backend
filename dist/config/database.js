"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const logger_1 = __importDefault(require("../utils/logger"));
const prisma = new client_1.PrismaClient({
    log: [
        {
            emit: 'event',
            level: 'query',
        },
        {
            emit: 'event',
            level: 'error',
        },
        {
            emit: 'event',
            level: 'info',
        },
        {
            emit: 'event',
            level: 'warn',
        },
    ],
});
prisma.$on('query', (e) => {
    logger_1.default.debug('Query: ' + e.query);
    logger_1.default.debug('Params: ' + e.params);
    logger_1.default.debug('Duration: ' + e.duration + 'ms');
});
prisma.$on('error', (e) => {
    logger_1.default.error('Database error:', e);
});
prisma.$on('info', (e) => {
    logger_1.default.info('Database info:', e);
});
prisma.$on('warn', (e) => {
    logger_1.default.warn('Database warning:', e);
});
process.on('beforeExit', async () => {
    logger_1.default.info('Closing database connection...');
    await prisma.$disconnect();
});
exports.default = prisma;
//# sourceMappingURL=database.js.map