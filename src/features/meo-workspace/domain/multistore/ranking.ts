import type { GroupId, StoreId, StoreSummary } from './types'

export interface StoreMetric { storeId: StoreId; value: number | null }
export interface RankedStore extends StoreMetric { rank: number | null }

export function rankStores(metrics: readonly StoreMetric[]): RankedStore[] {
  const ordered = metrics.filter((metric): metric is StoreMetric & { value: number } => metric.value !== null).sort((a, b) => b.value - a.value || a.storeId.localeCompare(b.storeId))
  const ranks = new Map<StoreId, number>(); let previous: number | undefined; let rank = 0
  ordered.forEach((metric, index) => { if (metric.value !== previous) rank = index + 1; ranks.set(metric.storeId, rank); previous = metric.value })
  return metrics.map((metric) => ({ ...metric, rank: metric.value === null ? null : (ranks.get(metric.storeId) ?? null) })).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.storeId.localeCompare(b.storeId))
}

export function groupStores(stores: readonly StoreSummary[]): Map<GroupId | null, StoreSummary[]> {
  const groups = new Map<GroupId | null, StoreSummary[]>()
  for (const store of [...stores].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = store.groupId ?? null; groups.set(key, [...(groups.get(key) ?? []), store])
  }
  return groups
}

export interface StoreComparison { storeId: StoreId; value: number | null; differenceFromAverage: number | null }
export function compareStores(metrics: readonly StoreMetric[]): StoreComparison[] {
  const present = metrics.flatMap((metric) => metric.value === null ? [] : [metric.value])
  const average = present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null
  return metrics.map(({ storeId, value }) => ({ storeId, value, differenceFromAverage: value === null || average === null ? null : value - average }))
}
