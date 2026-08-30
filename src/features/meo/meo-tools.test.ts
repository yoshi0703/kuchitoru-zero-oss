import { describe, expect, test } from 'vitest'
import {
  HEALTH_CHECKS,
  buildGoogleMapsSearchUrl,
  buildReviewReply,
  diagnoseProfile,
  prepareGooglePost,
  summarizeInsights,
} from './meo-tools'

describe('MEOの手動ツール', () => {
  test('低評価には未確認の改善約束を足さず謝罪と連絡案内だけを含める', () => {
    const reply = buildReviewReply({ review: '待ち時間が長かった', rating: 1, tone: 'polite' })
    expect(reply).toContain('お詫び')
    expect(reply).toContain('お知らせください')
    expect(reply).not.toMatch(/確認|改善|共有|対応/)
  })

  test('地域と検索語をGoogleマップURLへ安全に埋め込む', () => {
    expect(buildGoogleMapsSearchUrl('焼肉 & 個室', '新宿駅')).toBe(
      'https://www.google.com/maps/search/?api=1&query=%E6%96%B0%E5%AE%BF%E9%A7%85%20%E7%84%BC%E8%82%89%20%26%20%E5%80%8B%E5%AE%A4',
    )
  })

  test('閲覧数に対する行動率と次の一手を計算する', () => {
    expect(summarizeInsights({ views: 200, calls: 10, websiteClicks: 5, directionRequests: 25 })).toEqual({
      totalActions: 40,
      actionRate: 20,
      strongestAction: '経路検索',
      nextStep: '入口や駐車場がわかる写真を追加しましょう。',
    })
  })

  test('診断は未確認の最初の項目だけを次の作業にする', () => {
    const checked = new Set(HEALTH_CHECKS.slice(0, 2).map((check) => check.key))
    expect(diagnoseProfile(checked)).toEqual({
      score: 22,
      nextFix: 'Webサイトまたは予約ページを実際に開いて確認する',
    })
  })

  test('Instagram固有のタグを除いて本文を残す', () => {
    expect(prepareGooglePost('本日も営業中です。\n#新宿グルメ @sample\nご来店をお待ちしています。')).toBe(
      '本日も営業中です。\nご来店をお待ちしています。',
    )
  })

  test('deterministic helpers provide English presentation without changing source input', () => {
    expect(buildReviewReply({ review: '料理が最高でした', rating: 5, tone: 'friendly' }, 'en')).toContain('Thank you')
    expect(summarizeInsights({ views: 100, calls: 8, websiteClicks: 2, directionRequests: 1 }, 'en')).toEqual({
      totalActions: 11,
      actionRate: 11,
      strongestAction: 'Calls',
      nextStep: 'Make sure someone can answer during the hours when calls are most frequent.',
    })
    expect(diagnoseProfile(new Set(), 'en')).toEqual({
      score: 0,
      nextFix: 'Add a natural description of the store, its main products or services, and the area.',
    })
    expect(prepareGooglePost('日本語の原文 #internal')).toBe('日本語の原文')
  })
})
