import type { RankObservation } from './types'

export type LeaderboardDataState = 'current' | 'stale' | 'missing'
export interface StoreLeaderboardEntry {
  storeId: string
  dataState: LeaderboardDataState
  averageRank: number | null
  rankedCount: number
  latestObservedOn: string | null
}

export function createStoreLeaderboard(
  storeIds: readonly string[], observations: readonly RankObservation[], asOf: string, staleAfterDays = 7,
): StoreLeaderboardEntry[] {
  const cutoff = new Date(`${asOf}T00:00:00Z`).valueOf() - staleAfterDays * 86_400_000
  const entries: StoreLeaderboardEntry[] = storeIds.map((storeId) => {
    const items = observations.filter((item) => item.storeId === storeId)
    const latestObservedOn = items.reduce<string | null>((latest, item) => !latest || item.observedOn > latest ? item.observedOn : latest, null)
    const latest = items.filter((item) => item.observedOn === latestObservedOn)
    const ranked = latest.filter((item): item is RankObservation & { status: 'ranked' } => item.status === 'ranked')
    const dataState: LeaderboardDataState = latestObservedOn === null
      ? 'missing'
      : new Date(`${latestObservedOn}T00:00:00Z`).valueOf() < cutoff ? 'stale' : 'current'
    return {
      storeId, latestObservedOn, rankedCount: ranked.length,
      averageRank: ranked.length ? ranked.reduce((sum, item) => sum + item.rank, 0) / ranked.length : null,
      dataState,
    }
  })
  return entries.sort((a, b) => {
    const stateOrder = { current: 0, stale: 1, missing: 2 }
    return stateOrder[a.dataState] - stateOrder[b.dataState]
      || (a.averageRank ?? Number.POSITIVE_INFINITY) - (b.averageRank ?? Number.POSITIVE_INFINITY)
      || a.storeId.localeCompare(b.storeId)
  })
}
