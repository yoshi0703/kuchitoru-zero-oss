import type { MetricComparison } from './types'

export function compareMetric(previous: number, current: number): MetricComparison {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    throw new TypeError('比較値は有限数である必要があります')
  }
  const absoluteDelta = current - previous
  const percentageDelta = previous === 0
    ? current === 0
      ? { state: 'both_zero' as const, value: 0 as const }
      : { state: 'zero_baseline' as const, value: null }
    : { state: 'value' as const, value: (absoluteDelta / previous) * 100 }
  return { previous, current, absoluteDelta, percentageDelta }
}
