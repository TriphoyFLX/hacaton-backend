/** Rap Battle Elo / ladder helpers (server). */

export const BATTLE_ELO_DEFAULT = 1000;
export const BATTLE_ELO_K = 32;
export const BATTLE_ELO_SCALE_MAX = 2000;

export const BATTLE_RANKS = [
  { id: 'rookie', label: 'Новичок', min: 0, max: 899 },
  { id: 'amateur', label: 'Любитель', min: 900, max: 1099 },
  { id: 'fighter', label: 'Боец', min: 1100, max: 1299 },
  { id: 'pro', label: 'Профи', min: 1300, max: 1499 },
  { id: 'elite', label: 'Элита', min: 1500, max: 1699 },
  { id: 'legend', label: 'Легенда', min: 1700, max: 100000 },
] as const;

export type BattleRankId = (typeof BATTLE_RANKS)[number]['id'];

export function getBattleRank(elo: number) {
  const value = Math.max(0, Math.round(elo));
  const rank = BATTLE_RANKS.find((r) => value >= r.min && value <= r.max) || BATTLE_RANKS[BATTLE_RANKS.length - 1];
  const next = BATTLE_RANKS.find((r) => r.min > rank.min) || null;
  const span = rank.max === 100000 ? 300 : rank.max - rank.min + 1;
  const progressInRank = Math.min(1, Math.max(0, (value - rank.min) / span));
  const scaleProgress = Math.min(1, Math.max(0, value / BATTLE_ELO_SCALE_MAX));

  return {
    elo: value,
    rankId: rank.id as BattleRankId,
    rankLabel: rank.label,
    rankMin: rank.min,
    rankMax: rank.max === 100000 ? BATTLE_ELO_SCALE_MAX : rank.max,
    nextRankLabel: next?.label ?? null,
    nextRankMin: next?.min ?? null,
    progressInRank,
    scaleProgress,
  };
}

export function expectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

export function nextElo(playerElo: number, opponentElo: number, score: 0 | 0.5 | 1, k = BATTLE_ELO_K): number {
  const expected = expectedScore(playerElo, opponentElo);
  return Math.max(0, Math.round(playerElo + k * (score - expected)));
}

export function battleRatingPayload(user: {
  battleElo?: number | null;
  battleWins?: number | null;
  battleLosses?: number | null;
  battleDraws?: number | null;
}) {
  const elo = user.battleElo ?? BATTLE_ELO_DEFAULT;
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
