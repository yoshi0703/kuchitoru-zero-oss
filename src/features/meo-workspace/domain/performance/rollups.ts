import type { InsightMetricSnapshot, RankObservation } from './types'

export interface RankRollup {
  storeId: string
  keywordId: string
  observedOn: string
  rankedCount: number
  notFoundCount: number
  averageRank: number | null
}

export function rollupRanks(observations: readonly RankObservation[]): RankRollup[] {
  const groups = new Map<string, RankObservation[]>()
  for (const observation of observations) {
    const key = [observation.storeId, observation.keywordId, observation.observedOn].join('\u0000')
    groups.set(key, [...(groups.get(key) ?? []), observation])
  }
  return [...groups.values()].map((group) => {
    const first = group.at(0)
    if (!first) throw new Error('空の順位グループは集計できません')
    const ranked = group.filter((item): item is RankObservation & { status: 'ranked' } => item.status === 'ranked')
    return {
      storeId: first.storeId, keywordId: first.keywordId, observedOn: first.observedOn,
      rankedCount: ranked.length, notFoundCount: group.length - ranked.length,
      averageRank: ranked.length === 0 ? null : ranked.reduce((sum, item) => sum + item.rank, 0) / ranked.length,
    }
  }).sort((a, b) => a.storeId.localeCompare(b.storeId) || a.keywordId.localeCompare(b.keywordId) || a.observedOn.localeCompare(b.observedOn))
}

export function rollupInsights(snapshots: readonly InsightMetricSnapshot[]) {
  const values = new Map<string, { snapshot: InsightMetricSnapshot; value: number }>()
  for (const item of snapshots) {
    const key = [item.storeId, item.metric, item.periodStart, item.periodEnd].join('\u0000')
    values.set(key, { snapshot: item, value: (values.get(key)?.value ?? 0) + item.value })
  }
  return [...values.values()].map(({ snapshot, value }) => {
    const { storeId, metric, periodStart, periodEnd } = snapshot
    return { storeId, metric, periodStart, periodEnd, value }
  }).sort((a, b) => a.storeId.localeCompare(b.storeId) || a.metric.localeCompare(b.metric) || a.periodStart.localeCompare(b.periodStart))
}
