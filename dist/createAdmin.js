"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
async function createAdmin() {
    try {
        const email = (process.env.ADMIN_EMAIL || 'admin@soundlab-studio.ru').trim().toLowerCase();
        const username = (process.env.ADMIN_USERNAME || 'soundlab_admin').trim();
        const password = process.env.ADMIN_PASSWORD?.trim()
            || crypto_1.default.randomBytes(18).toString('base64url');
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        const admin = await prisma.user.upsert({
            where: { email },
            update: {
                role: 'ADMIN',
                password: hashedPassword,
                emailVerified: true,
                emailVerificationCode: null,
                emailVerificationExpires: null,
                username,
            },
            create: {
                username,
                email,
                password: hashedPassword,
                birthDate: new Date('2000-01-01'),
                agreedToTerms: true,
                role: 'ADMIN',
                emailVerified: true,
            },
        });
        if (email !== 'admin@admin.com') {
            await prisma.user.updateMany({
                where: { email: 'admin@admin.com', role: 'ADMIN' },
                data: { role: 'USER' },
            });
        }
        console.log('Admin ready:');
        console.log(`  username: ${admin.username}`);
        console.log(`  email:    ${admin.email}`);
        console.log(`  role:     ${admin.role}`);
        console.log(`  password: ${password}`);
        console.log('Store this password securely — it will not be shown again.');
    }
    catch (error) {
        console.error('Failed to create admin:', error);
        process.exitCode = 1;
    }
    finally {
        await prisma.$disconnect();
    }
}
createAdmin();
//# sourceMappingURL=createAdmin.js.map