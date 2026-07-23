"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BATTLE_RANKS = exports.BATTLE_ELO_SCALE_MAX = exports.BATTLE_ELO_K = exports.BATTLE_ELO_DEFAULT = void 0;
exports.getBattleRank = getBattleRank;
exports.expectedScore = expectedScore;
exports.nextElo = nextElo;
exports.battleRatingPayload = battleRatingPayload;
exports.BATTLE_ELO_DEFAULT = 1000;
exports.BATTLE_ELO_K = 32;
exports.BATTLE_ELO_SCALE_MAX = 2000;
exports.BATTLE_RANKS = [
    { id: 'rookie', label: 'Новичок', min: 0, max: 899 },
    { id: 'amateur', label: 'Любитель', min: 900, max: 1099 },
    { id: 'fighter', label: 'Боец', min: 1100, max: 1299 },
    { id: 'pro', label: 'Профи', min: 1300, max: 1499 },
    { id: 'elite', label: 'Элита', min: 1500, max: 1699 },
    { id: 'legend', label: 'Легенда', min: 1700, max: 100000 },
];
function getBattleRank(elo) {
    const value = Math.max(0, Math.round(elo));
    const rank = exports.BATTLE_RANKS.find((r) => value >= r.min && value <= r.max) || exports.BATTLE_RANKS[exports.BATTLE_RANKS.length - 1];
    const next = exports.BATTLE_RANKS.find((r) => r.min > rank.min) || null;
    const span = rank.max === 100000 ? 300 : rank.max - rank.min + 1;
    const progressInRank = Math.min(1, Math.max(0, (value - rank.min) / span));
    const scaleProgress = Math.min(1, Math.max(0, value / exports.BATTLE_ELO_SCALE_MAX));
    return {
        elo: value,
        rankId: rank.id,
        rankLabel: rank.label,
        rankMin: rank.min,
        rankMax: rank.max === 100000 ? exports.BATTLE_ELO_SCALE_MAX : rank.max,
        nextRankLabel: next?.label ?? null,
        nextRankMin: next?.min ?? null,
        progressInRank,
        scaleProgress,
    };
}
function expectedScore(playerElo, opponentElo) {
    return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}
function nextElo(playerElo, opponentElo, score, k = exports.BATTLE_ELO_K) {
    const expected = expectedScore(playerElo, opponentElo);
    return Math.max(0, Math.round(playerElo + k * (score - expected)));
}
function battleRatingPayload(user) {
    const elo = user.battleElo ?? exports.BATTLE_ELO_DEFAULT;
    const wins = user.battleWins ?? 0;
    const losses = user.battleLosses ?? 0;
    const draws = user.battleDraws ?? 0;
    return {
        battleElo: elo,
        battleWins: wins,
        battleLosses: losses,
        battleDraws: draws,
        battleGames: wins + losses + draws,
        ...getBattleRank(elo),
    };
}
//# sourceMappingURL=battleRating.js.map