import { PrismaClient, BattleWinner } from '@prisma/client';
import { BATTLE_ELO_DEFAULT, nextElo } from './battleRating';

const prisma = new PrismaClient();

/**
 * Apply Elo + W/L once when a battle finishes.
 * Safe to call multiple times — guarded by eloApplied.
 */
export async function applyBattleEloResult(
  battleId: string,
  winner: BattleWinner
): Promise<{ applied: boolean }> {
  return prisma.$transaction(async (tx) => {
    const battle = await tx.battle.findUnique({
      where: { id: battleId },
      include: {
        participants: {
          where: { role: { in: ['CREATOR', 'OPPONENT'] } },
          select: { userId: true, role: true },
        },
      },
    });

    if (!battle || battle.eloApplied) {
      return { applied: false };
    }

    const creatorId = battle.creatorId;
    const opponentId =
      battle.participants.find((p) => p.role === 'OPPONENT')?.userId ||
      battle.participants.find((p) => p.userId !== creatorId)?.userId;

    if (!opponentId) {
      return { applied: false };
    }

    const [creator, opponent] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: creatorId },
        select: { id: true, battleElo: true, battleWins: true, battleLosses: true, battleDraws: true },
      }),
      tx.user.findUniqueOrThrow({
        where: { id: opponentId },
        select: { id: true, battleElo: true, battleWins: true, battleLosses: true, battleDraws: true },
      }),
    ]);

    const creatorElo = creator.battleElo ?? BATTLE_ELO_DEFAULT;
    const opponentElo = opponent.battleElo ?? BATTLE_ELO_DEFAULT;

    let creatorScore: 0 | 0.5 | 1 = 0.5;
    let opponentScore: 0 | 0.5 | 1 = 0.5;
    if (winner === 'USER1') {
      creatorScore = 1;
      opponentScore = 0;
    } else if (winner === 'USER2') {
      creatorScore = 0;
      opponentScore = 1;
    }

    const creatorNext = nextElo(creatorElo, opponentElo, creatorScore);
    const opponentNext = nextElo(opponentElo, creatorElo, opponentScore);

    await tx.user.update({
      where: { id: creator.id },
      data: {
        battleElo: creatorNext,
        battleWins: { increment: winner === 'USER1' ? 1 : 0 },
        battleLosses: { increment: winner === 'USER2' ? 1 : 0 },
        battleDraws: { increment: winner === 'DRAW' ? 1 : 0 },
      },
    });

    await tx.user.update({
      where: { id: opponent.id },
      data: {
        battleElo: opponentNext,
        battleWins: { increment: winner === 'USER2' ? 1 : 0 },
        battleLosses: { increment: winner === 'USER1' ? 1 : 0 },
        battleDraws: { increment: winner === 'DRAW' ? 1 : 0 },
      },
    });

    await tx.battle.update({
      where: { id: battleId },
      data: { eloApplied: true },
    });

    return { applied: true };
  });
}
