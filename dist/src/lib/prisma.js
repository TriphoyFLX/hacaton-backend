"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.__soundlabPrisma ??
    new client_1.PrismaClient({
        log: process.env.NODE_ENV === 'production'
            ? [{ emit: 'stdout', level: 'error' }]
            : process.env.PRISMA_LOG === 'query'
                ? [{ emit: 'stdout', level: 'query' }, { emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }]
                : [{ emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }],
    });
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__soundlabPrisma = exports.prisma;
}
exports.default = exports.prisma;
//# sourceMappingURL=prisma.js.map