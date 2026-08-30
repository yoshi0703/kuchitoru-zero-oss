import { beforeEach, describe, expect, test, vi } from 'vitest'
import type * as HttpModule from '../../shared/api/http'
import { getMeoFeatureCapabilities } from './meo-api'

const apiRequestMock = vi.hoisted(() => vi.fn())

vi.mock('../../shared/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>()
  return { ...actual, apiRequest: apiRequestMock }
})

const validResponse = {
  serverTime: '2026-08-11T03:00:00.000Z',
  features: [
    { key: 'review_reply', title: '口コミ返信', status: 'available', releaseAt: null, executionMode: 'owner_provider', reason: null },
    { key: 'meo_rank', title: '順位チェック', status: 'available', releaseAt: null, executionMode: 'owner_provider', reason: null },
    { key: 'gbp_insights', title: 'Googleマップ分析', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
    { key: 'gbp_health', title: 'プロフィール診断', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
    { key: 'instagram_to_gbp', title: 'Instagram投稿の再利用', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
  ],
}

beforeEach(() => apiRequestMock.mockResolvedValue(validResponse))

describe('getMeoFeatureCapabilities', () => {
  test('owner認証付きの固定エンドポイントから取得する', async () => {
    await expect(getMeoFeatureCapabilities()).resolves.toEqual(validResponse)
    expect(apiRequestMock).toHaveBeenCalledWith('/owner-api/v2/feature-capabilities', { ownerAuth: true })
  })

  test('店舗単位の公開状態はstore-scoped endpointから取得する', async () => {
    await expect(getMeoFeatureCapabilities('store/with spaces')).resolves.toEqual(validResponse)
    expect(apiRequestMock).toHaveBeenCalledWith('/owner-api/v2/stores/store%2Fwith%20spaces/feature-capabilities', { ownerAuth: true })
  })

  test('順序が違う5機能応答を固定順へ正規化する', async () => {
    apiRequestMock.mockResolvedValue({
      ...validResponse,
      features: [
        validResponse.features[4],
        validResponse.features[3],
        validResponse.features[2],
        validResponse.features[1],
        validResponse.features[0],
      ],
    })

    await expect(getMeoFeatureCapabilities()).resolves.toEqual(validResponse)
  })

  test('未知のkeyを安全側で拒否する', async () => {
    apiRequestMock.mockResolvedValue({
      ...validResponse,
      features: [{ ...validResponse.features[0], key: 'unknown' }],
    })
    await expect(getMeoFeatureCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  test('同じkeyの重複を拒否する', async () => {
    apiRequestMock.mockResolvedValue({
      ...validResponse,
      features: [...validResponse.features, validResponse.features[0]],
    })
    await expect(getMeoFeatureCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  test('5機能のうち1件でも欠けた応答を拒否する', async () => {
    apiRequestMock.mockResolvedValue({
      ...validResponse,
      features: validResponse.features.slice(1),
    })
    await expect(getMeoFeatureCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  test('プロフィール診断の不正な公開状態を拒否する', async () => {
    apiRequestMock.mockResolvedValue({
      ...validResponse,
      features: [
        ...validResponse.features.slice(0, 3),
        {
          ...validResponse.features[3],
          status: 'unknown',
        },
        validResponse.features[4],
      ],
    })
    await expect(getMeoFeatureCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  test('不正な公開日時を拒否する', async () => {
    apiRequestMock.mockResolvedValue({ ...validResponse, serverTime: 'not-a-date' })
    await expect(getMeoFeatureCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  test('英語presentationでは不正応答を安全な英語で返す', async () => {
    apiRequestMock.mockResolvedValue({ ...validResponse, serverTime: 'not-a-date' })
    await expect(getMeoFeatureCapabilities(undefined, 'en')).rejects.toMatchObject({ message: 'Feature availability could not be verified.' })
  })

  test('旧実行モードを拒否する', async () => {
    apiRequestMock.mockResolvedValue({
      ...validResponse,
      features: [{ ...validResponse.features[0], executionMode: 'sponsored' }],
    })
    await expect(getMeoFeatureCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
