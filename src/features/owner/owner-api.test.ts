import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }))

vi.mock('../../shared/api/http', () => ({ apiRequest: apiRequestMock }))
vi.mock('../../shared/config/runtime', () => ({
  runtimeConfig: { isE2ETestMode: false },
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: null }))

import { createOwnerStore, getSurveyRevisions } from './owner-api'

const storeId = '44444444-4444-4444-8444-444444444444'

describe('owner survey API', () => {
  beforeEach(() => apiRequestMock.mockReset())

  it('loads and validates owner survey revision snapshots through the owner API', async () => {
    apiRequestMock.mockResolvedValue([{
      revision: 1,
      config: {
        version: 3,
        presetId: null,
        title: 'アンケート',
        description: '回答してください。',
        revision: 1,
        questions: [{ id: 'q_000000000001', type: 'short_text', label: '利用内容', required: false, maxLength: 120 }],
      },
    }])

    await expect(getSurveyRevisions(storeId)).resolves.toHaveLength(1)
    expect(apiRequestMock).toHaveBeenCalledWith(`/owner-api/v2/stores/${storeId}/survey-revisions`, { ownerAuth: true })
  })
})

describe('owner store creation API', () => {
  beforeEach(() => apiRequestMock.mockReset())

  it('uses the caller-owned idempotency key for an exact create retry', async () => {
    const idempotencyKey = '22222222-2222-4222-8222-222222222222'
    apiRequestMock.mockResolvedValue({ id: storeId, name: '同じ店舗' })

    await createOwnerStore({ name: '同じ店舗' }, idempotencyKey)
    await createOwnerStore({ name: '同じ店舗' }, idempotencyKey)

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, '/owner-api/v2/stores', {
      method: 'POST',
      body: { name: '同じ店舗' },
      ownerAuth: true,
      idempotencyKey,
    })
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, '/owner-api/v2/stores', {
      method: 'POST',
      body: { name: '同じ店舗' },
      ownerAuth: true,
      idempotencyKey,
    })
  })
})
