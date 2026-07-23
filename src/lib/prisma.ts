import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __soundlabPrisma?: PrismaClient };

/**
 * Single shared Prisma client for the whole process.
 * Multiple `new PrismaClient()` instances open separate connection pools
 * and burn DB connections under load.
 */
export const prisma =
  globalForPrisma.__soundlabPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? [{ emit: 'stdout', level: 'error' }]
        : process.env.PRISMA_LOG === 'query'
          ? [{ emit: 'stdout', level: 'query' }, { emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }]
          : [{ emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__soundlabPrisma = prisma;
}

export default prisma;
