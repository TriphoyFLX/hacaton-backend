import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Creates / resets the platform admin.
 * Usage:
 *   ADMIN_EMAIL=admin@soundlab-studio.ru ADMIN_PASSWORD='...' npx ts-node createAdmin.ts
 * If ADMIN_PASSWORD is omitted, a strong random password is generated and printed once.
 */
async function createAdmin() {
  try {
    const email = (process.env.ADMIN_EMAIL || 'admin@soundlab-studio.ru').trim().toLowerCase();
    const username = (process.env.ADMIN_USERNAME || 'soundlab_admin').trim();
    const password =
      process.env.ADMIN_PASSWORD?.trim()
      || crypto.randomBytes(18).toString('base64url');

    const hashedPassword = await bcrypt.hash(password, 12);

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

    // Demote any leftover weak demo admin if it still exists under the old email
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
  } catch (error) {
    console.error('Failed to create admin:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
