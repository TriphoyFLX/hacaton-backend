import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
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
  } catch (error) {
    console.error('Ошибка при создании админа:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
