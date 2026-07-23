import { prisma } from '../lib/prisma';


export class BlockRepository {
  async blockUser(blockerId: string, blockedId: string) {
    return prisma.block.upsert({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
      update: {},
      create: { blockerId, blockedId },
    });
  }

  async unblockUser(blockerId: string, blockedId: string) {
    return prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });
  }

  async isBlockedBy(blockerId: string, blockedId: string): Promise<boolean> {
    const block = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });
    return !!block;
  }

  async isEitherBlocked(userId1: string, userId2: string): Promise<boolean> {
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId1, blockedId: userId2 },
          { blockerId: userId2, blockedId: userId1 },
        ],
      },
    });
    return !!block;
  }

  async getBlockedUserIds(userId: string): Promise<string[]> {
    const blocks = await prisma.block.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    });
    return blocks.map(b => b.blockedId);
  }
}

export const blockRepository = new BlockRepository();
