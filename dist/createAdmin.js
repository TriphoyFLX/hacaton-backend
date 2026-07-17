"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function createAdmin() {
    try {
        const hashedPassword = await bcryptjs_1.default.hash('admin123', 10);
        const admin = await prisma.user.upsert({
            where: { email: 'admin@admin.com' },
            update: {
                role: 'ADMIN',
                password: hashedPassword
            },
            create: {
                username: 'admin',
                email: 'admin@admin.com',
                password: hashedPassword,
                birthDate: new Date('2000-01-01'),
                agreedToTerms: true,
                role: 'ADMIN'
            }
        });
        console.log('Админ создан успешно:', {
            username: admin.username,
            email: admin.email,
            role: admin.role
        });
    }
    catch (error) {
        console.error('Ошибка при создании админа:', error);
    }
    finally {
        await prisma.$disconnect();
    }
}
createAdmin();
//# sourceMappingURL=createAdmin.js.map