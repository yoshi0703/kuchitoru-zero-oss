import { describe, expect, it } from 'vitest'
import {
  compareMetric, createStoreLeaderboard, exportReportCsv, exportReportJson,
  importManualRankCsv, rollupInsights, rollupRanks, validateRankObservation,
  type PerformanceReport, type RankObservation,
} from './index'

const ranked = (overrides: Partial<RankObservation> = {}): RankObservation => ({
  id: 'rank-1', storeId: 'store-a', keywordId: 'keyword-a', observedOn: '2026-08-12',
  source: 'manual', status: 'ranked', rank: 3, ...overrides,
} as RankObservation)

describe('rank validation and CSV import', () => {
  it('accepts rank bounds and explicit not-found, but rejects out-of-range ranks', () => {
    expect(validateRankObservation(ranked({ rank: 1 })).ok).toBe(true)
    expect(validateRankObservation(ranked({ rank: 100 })).ok).toBe(true)
    expect(validateRankObservation(ranked({ rank: 101 })).ok).toBe(false)
    expect(validateRankObservation({ ...ranked(), status: 'not_found', rank: null }).ok).toBe(true)
  })

  it('validates manual CSV rows and imports not-found without inventing a rank', () => {
    const csv = [
      'id,store_id,keyword_id,observed_on,rank,status,source,competitor_id',
      'one,store-a,kw-a,2026-08-12,7,ranked,manual,',
      'two,store-a,kw-a,2026-08-12,,not_found,manual,',
    ].join('\n')
    const result = importManualRankCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[1]).toMatchObject({ status: 'not_found', rank: null })
    expect(importManualRankCsv(csv.replace('2026-08-12,7', '2026-02-30,7')).ok).toBe(false)
    expect(importManualRankCsv(csv.replace('ranked,manual', 'ranked,google_business')).ok).toBe(false)
  })

  it('localizes validation copy without changing imported machine or source values', () => {
    const csv = [
      'id,store_id,keyword_id,observed_on,rank,status,source,competitor_id',
      '東京-rank,店舗 / Store,カフェ cafe,2026-08-12,7,ranked,manual,競合 A',
    ].join('\n')
    expect(importManualRankCsv(csv, 'en')).toEqual(importManualRankCsv(csv))
    const ja = validateRankObservation(ranked({ rank: 101 }))
    const en = validateRankObservation(ranked({ rank: 101 }), undefined, 'en')
    expect(en.ok).toBe(false)
    if (!ja.ok && !en.ok) {
      expect(en.issues.map(({ field, row }) => ({ field, row }))).toEqual(ja.issues.map(({ field, row }) => ({ field, row })))
      expect(ja.issues[0]?.message).toContain('1〜100')
      expect(en.issues[0]?.message).toBe('Enter an integer from 1 to 100')
    }
  })
})

describe('comparisons and rollups', () => {
  it('expresses both zero-baseline states deterministically', () => {
    expect(compareMetric(0, 9)).toMatchObject({ absoluteDelta: 9, percentageDelta: { state: 'zero_baseline', value: null } })
    expect(compareMetric(0, 0).percentageDelta).toEqual({ state: 'both_zero', value: 0 })
    expect(compareMetric(4, 6).percentageDelta).toEqual({ state: 'value', value: 50 })
  })

  it('rolls ranks up by store, keyword, and date and GBP insights separately', () => {
    const ranks = rollupRanks([ranked(), ranked({ id: 'two', rank: 5 }), { ...ranked({ id: 'three' }), status: 'not_found', rank: null }])
    expect(ranks).toEqual([{ storeId: 'store-a', keywordId: 'keyword-a', observedOn: '2026-08-12', rankedCount: 2, notFoundCount: 1, averageRank: 4 }])
    const base = { storeId: 'store-a', metric: 'calls' as const, periodStart: '2026-08-01', periodEnd: '2026-08-07', source: 'google_business' as const }
    expect(rollupInsights([{ ...base, id: 'a', value: 2 }, { ...base, id: 'b', value: 3 }])).toEqual([
      { storeId: 'store-a', metric: 'calls', periodStart: '2026-08-01', periodEnd: '2026-08-07', value: 5 },
    ])
  })
})

describe('presentation data', () => {
  it('puts current data first while explicitly retaining stale and missing stores', () => {
    const entries = createStoreLeaderboard(
      ['missing', 'stale', 'current'],
      [ranked({ storeId: 'stale', observedOn: '2026-07-01' }), ranked({ storeId: 'current', observedOn: '2026-08-11' })],
      '2026-08-12', 7,
    )
    expect(entries.map(({ storeId, dataState }) => [storeId, dataState])).toEqual([
      ['current', 'current'], ['stale', 'stale'], ['missing', 'missing'],
    ])
  })
})

describe('versioned exports', () => {
  const report: PerformanceReport = {
    id: '週次レポート', generatedAt: '2026-08-12T00:00:00Z',
    period: { current: { start: '2026-08-06', end: '2026-08-12' }, previous: { start: '2026-07-30', end: '2026-08-05' } },
    ranks: [ranked({ keywordId: '=HYPERLINK("悪意")' })],
    insights: [{ id: 'i', storeId: 'store-a', metric: 'calls', periodStart: '2026-08-06', periodEnd: '2026-08-12', value: 4, source: 'google_business' }],
  }

  it('neutralizes Japanese CSV formula injection and keeps datasets distinct', () => {
    const csv = exportReportCsv(report)
    expect(csv.content).toContain('"\'=HYPERLINK(""悪意"")"')
    expect(csv.content).toContain('"rank"')
    expect(csv.content).toContain('"gbp_insight"')
  })

  it('produces stable, versioned JSON and CSV export envelopes', () => {
    expect(exportReportJson(report)).toEqual(exportReportJson(report))
    expect(exportReportCsv(report)).toEqual(exportReportCsv(report))
    expect(JSON.parse(exportReportJson(report).content)).toMatchObject({ version: '1.0', kind: 'performance_report' })
    expect(exportReportCsv(report).filename).toContain('.v1.0.csv')
  })
})
