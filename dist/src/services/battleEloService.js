"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyBattleEloResult = applyBattleEloResult;
const prisma_1 = require("../lib/prisma");
const battleRating_1 = require("./battleRating");
async function applyBattleEloResult(battleId, winner) {
    return prisma_1.prisma.$transaction(async (tx) => {
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
        const opponentId = battle.participants.find((p) => p.role === 'OPPONENT')?.userId ||
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
        const creatorElo = creator.battleElo ?? battleRating_1.BATTLE_ELO_DEFAULT;
        const opponentElo = opponent.battleElo ?? battleRating_1.BATTLE_ELO_DEFAULT;
        let creatorScore = 0.5;
        let opponentScore = 0.5;
        if (winner === 'USER1') {
            creatorScore = 1;
            opponentScore = 0;
        }
        else if (winner === 'USER2') {
            creatorScore = 0;
            opponentScore = 1;
        }
        const creatorNext = (0, battleRating_1.nextElo)(creatorElo, opponentElo, creatorScore);
        const opponentNext = (0, battleRating_1.nextElo)(opponentElo, creatorElo, opponentScore);
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
//# sourceMappingURL=battleEloService.js.map