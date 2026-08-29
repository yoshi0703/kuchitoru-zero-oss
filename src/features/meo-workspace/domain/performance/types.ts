export const PERFORMANCE_EXPORT_VERSION = '1.0' as const

export type PerformanceSource =
  | 'manual'
  | 'google_business'
  | 'owner_provider'

export interface Keyword {
  id: string
  text: string
}

export interface Competitor {
  id: string
  name: string
}

interface RankObservationBase {
  id: string
  storeId: string
  keywordId: string
  observedOn: string
  source: PerformanceSource
  competitorId?: string
}

export type RankObservation = RankObservationBase &
  ({ status: 'ranked'; rank: number } | { status: 'not_found'; rank: null })

export type GbpMetric =
  | 'website_clicks'
  | 'calls'
  | 'directions'
  | 'messages'
  | 'search_views'
  | 'map_views'

export interface InsightMetricSnapshot {
  id: string
  storeId: string
  metric: GbpMetric
  periodStart: string
  periodEnd: string
  value: number
  source: Exclude<PerformanceSource, 'manual'>
}

export interface ComparisonPeriod {
  current: { start: string; end: string }
  previous: { start: string; end: string }
}

export type PercentageDelta =
  | { state: 'value'; value: number }
  | { state: 'zero_baseline'; value: null }
  | { state: 'both_zero'; value: 0 }

export interface MetricComparison {
  previous: number
  current: number
  absoluteDelta: number
  percentageDelta: PercentageDelta
}

export interface PerformanceReport {
  id: string
  generatedAt: string
  period: ComparisonPeriod
  ranks: RankObservation[]
  insights: InsightMetricSnapshot[]
}

export interface ExportResult {
  version: typeof PERFORMANCE_EXPORT_VERSION
  format: 'json' | 'csv'
  mimeType: string
  filename: string
  content: string
}

export interface ValidationIssue {
  row?: number
  field: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] }
