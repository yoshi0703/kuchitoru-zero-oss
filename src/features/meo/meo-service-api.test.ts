import { beforeEach, expect, test, vi } from 'vitest'
import {
  completeMeoOauthConnection,
  checkGbpHealth,
  createReviewReplyDraft,
  getMeoExternalWriteSettings,
  getLatestGbpHealthResult,
  getInsightHistory,
  requestRankMeasurement,
  startMeoOauthConnection,
  updateMeoExternalWriteSettings,
} from './meo-service-api'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock('../../shared/api/http', () => ({ apiRequest: mocks.apiRequest }))

const STORE_ID = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.apiRequest.mockResolvedValue({})
})

test('口コミ返信案APIへlocaleをそのまま送る', async () => {
  await createReviewReplyDraft(STORE_ID, {
    rating: 5,
    reviewComment: 'とても良かったです',
    tone: 'warm',
    locale: 'en',
  })

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/review-replies/draft`,
    {
      method: 'POST',
      body: { rating: 5, reviewComment: 'とても良かったです', tone: 'warm', locale: 'en' },
      ownerAuth: true,
    },
  )
})

test('OAuth開始APIへchallengeだけを送る', async () => {
  await startMeoOauthConnection(STORE_ID, 'google_business', { challenge: 'c'.repeat(43) })

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/connections/google_business/start`,
    {
      method: 'POST',
      body: { challenge: 'c'.repeat(43) },
      ownerAuth: true,
    },
  )
})

test('外部書き込み設定を取得し、固定Idempotency-Keyで更新する', async () => {
  await getMeoExternalWriteSettings(STORE_ID)
  await updateMeoExternalWriteSettings(
    STORE_ID,
    true,
    '88888888-8888-4888-8888-888888888888',
  )

  expect(mocks.apiRequest).toHaveBeenNthCalledWith(
    1,
    `/meo-api/v1/stores/${STORE_ID}/external-writes`,
    { ownerAuth: true },
  )
  expect(mocks.apiRequest).toHaveBeenNthCalledWith(
    2,
    `/meo-api/v1/stores/${STORE_ID}/external-writes`,
    {
      method: 'PATCH',
      body: { enabled: true },
      ownerAuth: true,
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
    },
  )
})

test('OAuth完了APIへstate code verifierと固定Idempotency-Keyを送る', async () => {
  await completeMeoOauthConnection(
    STORE_ID,
    'instagram',
    { state: 's'.repeat(43), code: 'authorization-code', verifier: 'v'.repeat(43) },
    '66666666-6666-4666-8666-666666666666',
  )

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/connections/instagram/complete`,
    {
      method: 'POST',
      body: { state: 's'.repeat(43), code: 'authorization-code', verifier: 'v'.repeat(43) },
      ownerAuth: true,
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
    },
  )
})

test('Googleマップ分析の保存履歴をowner認証付きで取得する', async () => {
  await getInsightHistory(STORE_ID)

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/insights`,
    { ownerAuth: true },
  )
})

test('順位計測はowner providerの利用を明示して送る', async () => {
  const input = {
    keyword: '新宿 カフェ',
    targetPlaceId: 'ChIJ1234567890',
    competitorPlaceIds: [],
    latitude: 35.6895,
    longitude: 139.6917,
    credentialSource: 'owner_provider' as const,
  }

  await requestRankMeasurement(STORE_ID, input)

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/rank/measure`,
    { method: 'POST', body: input, ownerAuth: true },
  )
})

test('Google接続診断は固定Idempotency-KeyをAPI clientへ転送する', async () => {
  const diagnosis = {
    source: 'google_business',
    diagnosedAt: '2026-08-12T14:20:00.000Z',
    result: { score: 100, checks: [] },
  }
  mocks.apiRequest.mockResolvedValue(diagnosis)

  await expect(checkGbpHealth(
    STORE_ID,
    { useConnection: true },
    '77777777-7777-4777-8777-777777777777',
  )).resolves.toEqual(diagnosis)

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/health/check`,
    {
      method: 'POST',
      body: { useConnection: true },
      ownerAuth: true,
      idempotencyKey: '77777777-7777-4777-8777-777777777777',
    },
  )
})

test('最新のプロフィール診断結果をowner認証付きで取得する', async () => {
  await getLatestGbpHealthResult(STORE_ID)

  expect(mocks.apiRequest).toHaveBeenCalledWith(
    `/meo-api/v1/stores/${STORE_ID}/health/latest`,
    { ownerAuth: true },
  )
})
