export declare const BATTLE_ELO_DEFAULT = 1000;
export declare const BATTLE_ELO_K = 32;
export declare const BATTLE_ELO_SCALE_MAX = 2000;
export declare const BATTLE_RANKS: readonly [{
    readonly id: "rookie";
    readonly label: "Новичок";
    readonly min: 0;
    readonly max: 899;
}, {
    readonly id: "amateur";
    readonly label: "Любитель";
    readonly min: 900;
    readonly max: 1099;
}, {
    readonly id: "fighter";
    readonly label: "Боец";
    readonly min: 1100;
    readonly max: 1299;
}, {
    readonly id: "pro";
    readonly label: "Профи";
    readonly min: 1300;
    readonly max: 1499;
}, {
    readonly id: "elite";
    readonly label: "Элита";
    readonly min: 1500;
    readonly max: 1699;
}, {
    readonly id: "legend";
    readonly label: "Легенда";
    readonly min: 1700;
    readonly max: 100000;
}];
export type BattleRankId = (typeof BATTLE_RANKS)[number]['id'];
export declare function getBattleRank(elo: number): {
    elo: number;
    rankId: BattleRankId;
    rankLabel: "Новичок" | "Любитель" | "Боец" | "Профи" | "Элита" | "Легенда";
    rankMin: 0 | 900 | 1100 | 1300 | 1500 | 1700;
    rankMax: number;
    nextRankLabel: "Новичок" | "Любитель" | "Боец" | "Профи" | "Элита" | "Легенда" | null;
    nextRankMin: 0 | 900 | 1100 | 1300 | 1500 | 1700 | null;
    progressInRank: number;
    scaleProgress: number;
};
export declare function expectedScore(playerElo: number, opponentElo: number): number;
export declare function nextElo(playerElo: number, opponentElo: number, score: 0 | 0.5 | 1, k?: number): number;
export declare function battleRatingPayload(user: {
    battleElo?: number | null;
    battleWins?: number | null;
    battleLosses?: number | null;
    battleDraws?: number | null;
}): {
    elo: number;
    rankId: BattleRankId;
    rankLabel: "Новичок" | "Любитель" | "Боец" | "Профи" | "Элита" | "Легенда";
    rankMin: 0 | 900 | 1100 | 1300 | 1500 | 1700;
    rankMax: number;
    nextRankLabel: "Новичок" | "Любитель" | "Боец" | "Профи" | "Элита" | "Легенда" | null;
    nextRankMin: 0 | 900 | 1100 | 1300 | 1500 | 1700 | null;
    progressInRank: number;
    scaleProgress: number;
    battleElo: number;
    battleWins: number;
    battleLosses: number;
    battleDraws: number;
    battleGames: number;
};
//# sourceMappingURL=battleRating.d.ts.map