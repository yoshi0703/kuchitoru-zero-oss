import { describe, expect, test } from 'vitest'
import { isScopedRouteActive, ownerStorePath, ownerStoreSwitchPath } from './store-scope'

const storeId = '44444444-4444-4444-8444-444444444444'
const nextStoreId = '55555555-5555-4555-8555-555555555555'

describe('store-scoped routing', () => {
  test('店舗ホームは子画面で現在地扱いにしない', () => {
    const storeHome = ownerStorePath(storeId)

    expect(isScopedRouteActive(storeHome, storeHome, true)).toBe(true)
    expect(isScopedRouteActive(storeHome, `${storeHome}/survey`, true)).toBe(false)
  })

  test('店舗の子画面は詳細パスを含めて現在地扱いにする', () => {
    const interviews = ownerStorePath(storeId, '/interviews')

    expect(isScopedRouteActive(interviews, `${interviews}/answer-id`)).toBe(true)
  })

  test('回答詳細で店舗を切り替えると新店舗の回答一覧へ戻す', () => {
    expect(ownerStoreSwitchPath(
      ownerStorePath(storeId, '/interviews/answer-id'),
      storeId,
      nextStoreId,
    )).toBe(ownerStorePath(nextStoreId, '/interviews'))
  })

  test('回答詳細以外で店舗を切り替えると同じ画面を維持する', () => {
    expect(ownerStoreSwitchPath(
      ownerStorePath(storeId, '/summary'),
      storeId,
      nextStoreId,
    )).toBe(ownerStorePath(nextStoreId, '/summary'))
  })
})
