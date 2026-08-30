import { describe, expect, it, vi } from 'vitest'
import { loadDashboardData, storeInformationIsComplete, surveyEditingIsComplete } from './dashboard-data'
import { DEFAULT_SURVEY_CONFIG, upcastV3ToV4 } from '../../shared/survey-config'

const surveyDefinition = (revision: number) => ({
  ...upcastV3ToV4(DEFAULT_SURVEY_CONFIG),
  revision,
})

const completeStore = {
  id: 'store-id',
  public_slug: 'sample-store',
  name: 'サンプル店',
  industry: null,
  address: null,
  description: null,
  website_url: null,
  welcome_message: null,
  closing_message: null,
  google_review_url: 'https://g.page/r/sample-store/review',
  google_place_id: null,
  status: 'draft' as const,
  owner_store_slot: 1,
  archived_at: null,
}

describe('loadDashboardData', () => {
  it('店舗がなければ店舗依存データを取得しない', async () => {
    const getSurvey = vi.fn()
    const getAi = vi.fn()
    const getSummary = vi.fn()
    const getRecent = vi.fn()

    await expect(loadDashboardData({
      getStore: vi.fn().mockResolvedValue(null),
      getSurvey,
      getAi,
      getSummary,
      getRecent,
    })).resolves.toEqual({
      store: null,
      setup: { storeInformationComplete: false, surveyEditingComplete: false, isComplete: false },
      ai: null,
      summary: null,
      recent: [],
    })

    expect(getSurvey).not.toHaveBeenCalled()
    expect(getAi).not.toHaveBeenCalled()
    expect(getSummary).not.toHaveBeenCalled()
    expect(getRecent).not.toHaveBeenCalled()
  })

  it('初期設定済みなら接続・集計・直近5件を取得する', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `row-${index}`,
      created_at: '2026-07-10T00:00:00.000Z',
      status: 'completed',
      rating: null,
      visit_frequency: null,
      generation_status: 'not_requested',
      generated_review: null,
      edited_review: null,
      generation_provider: null,
      google_handoff_opened_at: null,
      completed_at: null,
    }))

    const result = await loadDashboardData({
      getStore: vi.fn().mockResolvedValue(completeStore),
      getSurvey: vi.fn().mockResolvedValue(surveyDefinition(2)),
      getAi: vi.fn().mockResolvedValue(null),
      getSummary: vi.fn().mockResolvedValue(null),
      getRecent: vi.fn().mockResolvedValue({ rows }),
    })

    expect(result.store).toEqual(completeStore)
    expect(result.setup).toEqual({ storeInformationComplete: true, surveyEditingComplete: true, isComplete: true })
    expect(result.recent).toEqual(rows.slice(0, 5))
  })

  it('初期設定が未完了なら詳細データを取得しない', async () => {
    const store = { ...completeStore, google_review_url: null, owner_store_slot: 2 }
    const getAi = vi.fn()
    const getSummary = vi.fn()
    const getRecent = vi.fn()

    await expect(loadDashboardData({
      getStore: vi.fn().mockResolvedValue(store),
      getSurvey: vi.fn().mockResolvedValue(surveyDefinition(1)),
      getAi,
      getSummary,
      getRecent,
    })).resolves.toEqual({
      store,
      setup: { storeInformationComplete: false, surveyEditingComplete: false, isComplete: false },
      ai: null,
      summary: null,
      recent: [],
    })

    expect(getAi).not.toHaveBeenCalled()
    expect(getSummary).not.toHaveBeenCalled()
    expect(getRecent).not.toHaveBeenCalled()
  })

  it('Google口コミURLと保存済みアンケートを初期設定完了条件にする', () => {
    const baseStore = { ...completeStore, google_review_url: null }
    expect(storeInformationIsComplete(baseStore)).toBe(false)
    expect(storeInformationIsComplete({ ...baseStore, google_review_url: 'https://example.com/review' })).toBe(false)
    expect(storeInformationIsComplete(completeStore)).toBe(true)
    expect(surveyEditingIsComplete(surveyDefinition(1))).toBe(false)
    expect(surveyEditingIsComplete(surveyDefinition(2))).toBe(true)
  })
})
