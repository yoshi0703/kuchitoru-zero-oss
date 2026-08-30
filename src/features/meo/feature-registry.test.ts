import { describe, expect, test } from 'vitest'
import { meoFeatureDefinition, meoFeatureRoute } from './feature-registry'

describe('MEO Community feature registry', () => {
  test('順位機能は順位チェック画面へ向ける', () => {
    expect(meoFeatureDefinition('meo_rank')).toMatchObject({
      title: '順位チェック',
      shortTitle: '順位チェック',
      path: '/meo/rank',
    })
    expect(meoFeatureRoute('/dashboard/stores/store-id', 'meo_rank')).toBe('/dashboard/stores/store-id/meo/rank')
  })

  test('stable keyから英語の機能名を表示する', () => {
    expect(meoFeatureDefinition('gbp_insights', 'en')).toMatchObject({
      key: 'gbp_insights',
      title: 'Google Maps analytics',
      path: '/meo/insights',
    })
  })
})
