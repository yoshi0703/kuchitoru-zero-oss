import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import type { MeoWorkspaceRole } from './meo-workspace-api'
import {
  GbpProfileWorkspacePage,
  PerformanceWorkspacePage,
  PostWorkspacePage,
  ReviewInboxWorkspacePage,
} from './P0WorkspacePages'

const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  list: vi.fn(),
  mutate: vi.fn(),
}))
const i18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))

vi.mock('../../shared/i18n', () => ({ useI18n: () => ({ locale: i18n.locale, text: (value: { ja: string; en: string }) => value[i18n.locale], formatNumber: (value: number) => new Intl.NumberFormat(i18n.locale === 'ja' ? 'ja-JP' : 'en-US').format(value) }) }))

vi.mock('./meo-workspace-api', () => ({
  getMeoWorkspaceSnapshot: api.snapshot,
  listMeoWorkspaceResource: api.list,
  mutateMeoWorkspaceResource: api.mutate,
}))

const storeId = '44444444-4444-4444-8444-444444444444'
const organizationId = '33333333-3333-4333-8333-333333333333'

function workspace(role: MeoWorkspaceRole = 'owner') {
  return {
    authorization: { organizationId, storeId, role, approvalRequired: false },
    organization: { name: 'テスト組織' },
    store: { google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
    profile: {
      businessName: 'クチトル食堂',
      primaryCategory: 'レストラン',
      description: '地域の皆さまに毎日おいしい食事を届けるレストランです。旬の食材を使い、安心して楽しめる料理と丁寧な接客を大切にしています。ご家族でもお一人でもお気軽にご来店ください。',
      phoneNumbers: { primaryPhone: '03-0000-0000', additionalPhones: [] },
      websiteUri: 'https://example.test',
      businessHours: { monday: '10:00-18:00' },
      serviceArea: {}, attributes: { takeout: true }, openingDate: '2025-01-01',
      address: { addressLines: ['東京都新宿区1-1'], locality: '新宿区', administrativeArea: '東京都', postalCode: '100-0001' },
      specialHours: [], moreHours: [], additionalCategories: [], labels: [], languageCode: 'ja',
    },
    counts: {}, generatedAt: '2026-08-13T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  i18n.locale = 'ja'
  api.snapshot.mockResolvedValue(workspace())
  api.list.mockImplementation((_storeId: string, resource: string) => {
    if (resource === 'reviews') return Promise.resolve({ items: [{ id: '55555555-5555-4555-8555-555555555555', rating: 2, review_text: '待ち時間が長かった', reviewer_display_name: '田中', language: 'ja', status: 'needs_reply', reply_history: [{ body: '旧返信', language: 'ja', created_at: '2026-08-12T00:00:00Z' }] }], nextCursor: null })
    if (resource === 'review_templates') return Promise.resolve({ items: [], nextCursor: null })
    if (resource === 'posts') return Promise.resolve({ items: [{ id: '66666666-6666-4666-8666-666666666666', topic_type: 'update', summary: '本日も営業しています。', call_to_action: 'learn_more', call_to_action_url: 'https://example.test/menu', details: { language: 'ja', event: null, offer: null }, status: 'ready', latest_revision: { revision: 2, fingerprint: 'a'.repeat(64) } }], nextCursor: null })
    return Promise.resolve({ items: [], nextCursor: null })
  })
  api.mutate.mockResolvedValue({ data: { id: '77777777-7777-4777-8777-777777777777' }, approvalRequired: false, changeRequestId: null })
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
})

test.each([
  [<GbpProfileWorkspacePage />, 'GBP profile', 'クチトル食堂', 'Additional categories (comma-separated)', '店舗名（必須）'],
  [<ReviewInboxWorkspacePage />, 'Review inbox', '待ち時間が長かった', 'Rating distribution', 'ネイティブ集計'],
  [<PostWorkspacePage />, 'GBP posts', '本日も営業しています。', 'Draft and revision history', '下書き・改訂履歴'],
  [<PerformanceWorkspacePage />, 'Rankings & insights', 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'CSV columns:', '検索順位'],
])('English locale localizes P0 chrome while preserving Japanese source content', async (page, heading, preserved, localizedChrome, absentChrome) => {
  i18n.locale = 'en'
  renderPage(page)
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  expect(await screen.findByDisplayValue(preserved).catch(() => screen.findByText(preserved))).toBeVisible()
  expect(screen.getByText(localizedChrome, { exact: false })).toBeVisible()
  expect(screen.queryByText(absentChrome)).not.toBeInTheDocument()
})

test('English locale hides unknown upstream error text', async () => {
  i18n.locale = 'en'
  api.snapshot.mockRejectedValue(new Error('日本語の内部エラー'))
  renderPage(<GbpProfileWorkspacePage />)
  expect(await screen.findByText('The operation could not be completed.')).toBeVisible()
  expect(screen.queryByText('日本語の内部エラー')).not.toBeInTheDocument()
})

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/meo/workspace`]}>
        <Routes><Route path="/dashboard/stores/:storeId/meo/workspace" element={page} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('GBP画面は同一左端コンテナで全項目を編集し保存する', async () => {
  const { container } = renderPage(<GbpProfileWorkspacePage />)
  expect(await screen.findByRole('heading', { name: 'GBP店舗情報' })).toBeVisible()
  await screen.findByLabelText('店舗名（必須）')
  expect(container.querySelector('[data-meo-workspace-container="true"]')).toBeVisible()
  expect(container.querySelector(':scope [data-meo-workspace-align="start"]')).toBeVisible()
  fireEvent.change(screen.getByLabelText('店舗名（必須）'), { target: { value: '新クチトル食堂' } })
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'profile', 'save', expect.objectContaining({ businessName: '新クチトル食堂', primaryCategory: 'レストラン' })))
  expect(await screen.findByText('Zeroの店舗情報と新しいスナップショットを保存しました。')).toBeVisible()
})

test('口コミは受信箱から返信を編集し、Google送信を装わずZeroへ保存する', async () => {
  renderPage(<ReviewInboxWorkspacePage />)
  expect(await screen.findByText('待ち時間が長かった')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '開く' }))
  fireEvent.change(screen.getByLabelText('返信文'), { target: { value: 'お待たせして申し訳ありません。改善します。' } })
  fireEvent.click(screen.getByRole('button', { name: '返信をZeroに保存' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'reviews', 'update', expect.objectContaining({ replyText: 'お待たせして申し訳ありません。改善します。', status: 'replied' }), '55555555-5555-4555-8555-555555555555'))
  expect(await screen.findByText(/Googleには送信していません/)).toBeVisible()
  expect(screen.getByText(/旧返信/)).toBeVisible()
})

test('投稿は確認チェックと公開URLが揃った場合だけ手動公開確認を記録する', async () => {
  renderPage(<PostWorkspacePage />)
  expect(await screen.findByText('本日も営業しています。')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '編集' }))
  const record = screen.getByRole('button', { name: '公開確認を記録' })
  expect(record).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Googleの投稿URL'), { target: { value: 'https://business.google.com/posts/example' } })
  fireEvent.click(screen.getByLabelText('Googleで手動投稿し、公開内容を確認しました'))
  expect(record).toBeEnabled()
  fireEvent.click(record)
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'posts', 'record_publish_confirmation', expect.objectContaining({ provider: 'google_business', providerUrl: 'https://business.google.com/posts/example', revision: 2, revisionFingerprint: 'a'.repeat(64) }), '66666666-6666-4666-8666-666666666666'))
})

test('順位とインサイトは手入力をDBへ保存できる', async () => {
  renderPage(<PerformanceWorkspacePage />)
  expect(await screen.findByRole('heading', { name: '順位・インサイト' })).toBeVisible()
  await screen.findByLabelText('キーワード')
  fireEvent.change(screen.getByLabelText('キーワード'), { target: { value: '新宿 ランチ' } })
  fireEvent.change(screen.getByLabelText('順位（1〜100、圏外は空欄）'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('検索地点'), { target: { value: '新宿駅東口' } })
  fireEvent.click(screen.getByRole('button', { name: '順位を保存' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'rank_observations', 'create', expect.objectContaining({ keyword: '新宿 ランチ', rank: 3, targetPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', locationLabel: '新宿駅東口', source: 'manual' })))
})

test('Analystは閲覧と出力だけで、編集・公開操作が無効になる', async () => {
  api.snapshot.mockResolvedValue(workspace('analyst'))
  renderPage(<PostWorkspacePage />)
  expect(await screen.findByText('閲覧専用')).toBeVisible()
  expect(screen.getByLabelText('本文（必須）')).toBeDisabled()
  expect(screen.getByRole('button', { name: '下書きを保存' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '公開確認を記録' })).toBeDisabled()
})
