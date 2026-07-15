import { blockRepository } from '../repositories/blockRepository';
import { userRepository } from '../repositories/userRepository';

export class BlockService {
  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      return { success: false, error: 'Нельзя заблокировать себя' };
    }

    const user = await userRepository.getUserById(blockedId);
    if (!user) {
      return { success: false, error: 'Пользователь не найден' };
    }

    await blockRepository.blockUser(blockerId, blockedId);
    return { success: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await blockRepository.unblockUser(blockerId, blockedId);
    return { success: true };
  }

  async isBlockedByMe(blockerId: string, blockedId: string) {
    return blockRepository.isBlockedBy(blockerId, blockedId);
  }

  async isEitherBlocked(userId1: string, userId2: string) {
    return blockRepository.isEitherBlocked(userId1, userId2);
  }

  async getBlockedIds(userId: string) {
    return blockRepository.getBlockedUserIds(userId);
  }
}

export const blockService = new BlockService();
