import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import type { MeoWorkspaceRole } from './meo-workspace-api'
import { AioWorkspacePage, MultiStoreWorkspacePage } from './P1WorkspacePages'

const api = vi.hoisted(() => ({ snapshot: vi.fn(), list: vi.fn(), mutate: vi.fn(), stores: vi.fn() }))
const i18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))

vi.mock('../../shared/i18n', () => ({
  useI18n: () => ({
    locale: i18n.locale,
    text: ({ ja, en }: { ja: string; en: string }) => i18n.locale === 'ja' ? ja : en,
    formatNumber: (value: number) => new Intl.NumberFormat(i18n.locale === 'ja' ? 'ja-JP' : 'en-US').format(value),
  }),
}))

vi.mock('./meo-workspace-api', () => ({
  getMeoWorkspaceSnapshot: api.snapshot,
  listMeoWorkspaceResource: api.list,
  mutateMeoWorkspaceResource: api.mutate,
}))

vi.mock('../owner/owner-api', () => ({ getOwnerStores: api.stores }))

const storeId = '44444444-4444-4444-8444-444444444444'
const secondStoreId = '55555555-5555-4555-8555-555555555555'
const organizationId = '33333333-3333-4333-8333-333333333333'
const groupId = '66666666-6666-4666-8666-666666666666'
const requestId = '77777777-7777-4777-8777-777777777777'

function snapshot(role: MeoWorkspaceRole = 'owner', approvalRequired = false) {
  return {
    authorization: { organizationId, storeId, role, approvalRequired },
    organization: { id: organizationId, name: 'クチトル東日本', approval_policy: approvalRequired ? 'two_person' : 'owner_direct' },
    profile: {
      businessName: 'クチトル食堂', description: '地域の食堂です。', websiteUri: 'https://example.test',
      phoneNumbers: { primaryPhone: '03-1234-5678' },
      address: { postalCode: '100-0001', administrativeArea: '東京都', locality: '千代田区', addressLines: ['千代田1-1'] },
    }, counts: {}, generatedAt: '2026-08-13T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  i18n.locale = 'ja'
  api.snapshot.mockResolvedValue(snapshot())
  api.stores.mockResolvedValue([
    { id: storeId, name: '東京店', public_slug: 'tokyo', status: 'published', is_publicly_available: true },
    { id: secondStoreId, name: '大阪店', public_slug: 'osaka', status: 'draft', is_publicly_available: false },
  ])
  api.list.mockImplementation((_storeId: string, resource: string) => {
    if (resource === 'groups') return Promise.resolve({ items: [{ id: groupId, name: '東日本', status: 'active', description: '東日本店舗', store_ids: [] }], nextCursor: null })
    if (resource === 'members') return Promise.resolve({ items: [{ user_id: '88888888-8888-4888-8888-888888888888', email: 'analyst@example.test', role: 'analyst', status: 'active' }], nextCursor: null })
    if (resource === 'change_requests') return Promise.resolve({ items: [{ id: requestId, resource: 'groups', action: 'update', request_reason: '東日本の店舗構成を更新', payload: { store_ids: [storeId] }, status: 'pending', created_at: '2026-08-13T00:00:00Z' }], nextCursor: null })
    if (resource === 'aio_citations') return Promise.resolve({ items: [{ id: '99999999-9999-4999-8999-999999999999', source_name: 'Apple Business Connect', source_type: 'map', url: 'https://businessconnect.apple.com/example', nap_snapshot: { business_name: 'クチトル食堂', address: '〒100-0001 東京都千代田区千代田1-1', phone: '03-1234-5678', website_url: 'https://example.test' }, consistency_status: 'consistent', last_checked_at: '2026-08-12T00:00:00Z' }], nextCursor: null })
    if (resource === 'insights') return Promise.resolve({ items: [{ metrics: { views: _storeId === storeId ? 100 : 50 } }], nextCursor: null })
    return Promise.resolve({ items: [], nextCursor: null })
  })
  api.mutate.mockResolvedValue({ data: { id: requestId }, approvalRequired: false, changeRequestId: null })
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
})

function renderPage(element: React.ReactNode, path: 'multistore' | 'aio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/meo/workspace/${path}`]}>
        <Routes><Route path="/dashboard/stores/:storeId/meo/workspace/:page" element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('多店舗はdry-runの確認後だけグループ一括割当を適用する', async () => {
  const { container } = renderPage(<MultiStoreWorkspacePage />, 'multistore')
  expect(await screen.findByRole('heading', { name: '多店舗・権限' })).toBeVisible()
  expect(container.querySelector('[data-meo-workspace-container="true"]')).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'MEO管理' })).toHaveAttribute('data-meo-workspace-align', 'start')
  await screen.findByText('東京店')
  fireEvent.click(screen.getByLabelText('東京店を選択'))
  fireEvent.change(screen.getByLabelText('割当先グループ'), { target: { value: groupId } })
  expect(screen.queryByRole('button', { name: '確認した変更を適用' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '選択店舗をdry-run' }))
  expect(screen.getByText('1件を変更')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '確認した変更を適用' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'groups', 'update', { storeIds: [storeId] }, groupId))
})

test('現在のグループ所属を使い、変更済み店舗をdry-runで変更なしと判定する', async () => {
  api.list.mockImplementation((_storeId: string, resource: string) => {
    if (resource === 'groups') return Promise.resolve({ items: [{ id: groupId, name: '東日本', status: 'active', description: '東日本店舗', store_ids: [storeId] }], nextCursor: null })
    if (resource === 'members') return Promise.resolve({ items: [], nextCursor: null })
    if (resource === 'change_requests') return Promise.resolve({ items: [], nextCursor: null })
    if (resource === 'insights') return Promise.resolve({ items: [], nextCursor: null })
    return Promise.resolve({ items: [], nextCursor: null })
  })
  renderPage(<MultiStoreWorkspacePage />, 'multistore')
  await screen.findByText('東京店')
  fireEvent.click(screen.getByLabelText('東京店を選択'))
  fireEvent.change(screen.getByLabelText('割当先グループ'), { target: { value: groupId } })
  fireEvent.click(screen.getByRole('button', { name: '選択店舗をdry-run' }))
  expect(screen.getByText('0件を変更')).toBeVisible()
  expect(screen.getByText(/変更なし 1/)).toBeVisible()
  expect(screen.getByRole('button', { name: '確認した変更を適用' })).toBeDisabled()
})

test('Editorの一括変更は直接適用せずchange requestを作成する', async () => {
  api.snapshot.mockResolvedValue(snapshot('editor', true))
  renderPage(<MultiStoreWorkspacePage />, 'multistore')
  await screen.findByText('東京店')
  fireEvent.click(screen.getByLabelText('東京店を選択'))
  fireEvent.change(screen.getByLabelText('割当先グループ'), { target: { value: groupId } })
  fireEvent.click(screen.getByRole('button', { name: '選択店舗をdry-run' }))
  fireEvent.click(screen.getByRole('button', { name: '変更申請を作成' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'change_requests', 'create', expect.objectContaining({ resource: 'groups', action: 'update', recordId: groupId, payload: { storeIds: [storeId] } })))
  expect(api.mutate).not.toHaveBeenCalledWith(storeId, 'groups', 'update', expect.anything(), groupId)
})

test('Ownerは申請を承認して適用できる', async () => {
  renderPage(<MultiStoreWorkspacePage />, 'multistore')
  fireEvent.click(await screen.findByRole('tab', { name: /申請・承認/ }))
  expect(await screen.findByText('groups / update')).toBeVisible()
  expect(screen.getByText('東日本の店舗構成を更新')).toBeVisible()
  expect(screen.getByText(new RegExp(storeId))).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '承認して適用' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'change_requests', 'approve', { comment: null }, requestId))
})

test('Analystは多店舗設定と一括変更を編集できない', async () => {
  api.snapshot.mockResolvedValue(snapshot('analyst'))
  renderPage(<MultiStoreWorkspacePage />, 'multistore')
  expect(await screen.findByText('閲覧専用')).toBeVisible()
  expect(await screen.findByLabelText('東京店を選択')).toBeDisabled()
  expect(screen.getByRole('button', { name: '選択店舗をdry-run' })).toBeDisabled()
})

test('AIOは決定論的NAP診断と手動台帳を表示する', async () => {
  renderPage(<AioWorkspacePage />, 'aio')
  expect(await screen.findByRole('heading', { name: 'AIO・サイテーション' })).toBeVisible()
  expect(screen.getByText(/AI回答への掲載保証/)).toBeVisible()
  expect(await screen.findByText(/総合準備スコア/)).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: /サイテーション台帳/ }))
  expect((await screen.findAllByText('Apple Business Connect')).length).toBeGreaterThan(0)
  expect(screen.getByText('consistent')).toBeVisible()
})

test('AIOの掲載先は手動保存し、外部連携成功を装わない', async () => {
  renderPage(<AioWorkspacePage />, 'aio')
  fireEvent.click(await screen.findByRole('tab', { name: /サイテーション台帳/ }))
  fireEvent.change(screen.getByLabelText('掲載先名'), { target: { value: 'Bing Places' } })
  fireEvent.change(screen.getByLabelText('掲載URL（HTTPS）'), { target: { value: 'https://www.bingplaces.com/example' } })
  fireEvent.change(screen.getByLabelText('掲載されている店舗名'), { target: { value: 'クチトル食堂' } })
  fireEvent.click(screen.getByRole('button', { name: '掲載記録を追加' }))
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith(storeId, 'aio_citations', 'create', expect.objectContaining({ directory: 'Bing Places', listingUrl: 'https://www.bingplaces.com/example' } ), null))
  expect(await screen.findByText('サイテーション台帳へ保存しました。')).toBeVisible()
  expect(screen.queryByText(/Bingに送信しました/)).not.toBeInTheDocument()
})

test('AnalystはJSON-LDを出力できるが保存できない', async () => {
  api.snapshot.mockResolvedValue(snapshot('analyst'))
  renderPage(<AioWorkspacePage />, 'aio')
  fireEvent.click(await screen.findByRole('tab', { name: /JSON-LD/ }))
  expect(screen.getByRole('button', { name: 'JSON-LDを保存' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'JSON-LD出力' })).toBeEnabled()
})

test('English locale exposes localized workspace headings and tabs without changing source content', async () => {
  i18n.locale = 'en'
  renderPage(<MultiStoreWorkspacePage />, 'multistore')
  expect(await screen.findByRole('heading', { name: 'Multi-store & permissions' })).toBeVisible()
  expect(screen.getByRole('tab', { name: /Stores & CSV/ })).toBeVisible()
  expect(screen.getByRole('tab', { name: /Organization & groups/ })).toBeVisible()
  expect(await screen.findByText('東京店')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Stores and CSV' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Select 東京店' })).toBeVisible()
  expect(screen.queryByText('店舗一覧とCSV')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Requests & approvals/ }))
  expect(await screen.findByRole('heading', { name: 'Change requests and approvals' })).toBeVisible()
  expect(screen.getByText('東日本の店舗構成を更新')).toBeVisible()
  expect(screen.queryByText('変更申請と承認')).not.toBeInTheDocument()
})

test('English AIO locale keeps Japanese business and source strings intact', async () => {
  i18n.locale = 'en'
  renderPage(<AioWorkspacePage />, 'aio')
  expect(await screen.findByRole('heading', { name: 'AIO & citations' })).toBeVisible()
  expect(screen.getByRole('tab', { name: 'NAP diagnosis' })).toBeVisible()
  expect(screen.getByDisplayValue('クチトル食堂')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Canonical store NAP' })).toBeVisible()
  expect(screen.getByText('Overall readiness score')).toBeVisible()
  expect(screen.queryByText('店舗の基準NAP')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Citation ledger/ }))
  expect(await screen.findByRole('heading', { name: 'Manually record listing' })).toBeVisible()
  expect(screen.getByDisplayValue('クチトル食堂')).toBeVisible()
  expect(screen.getAllByText('Apple Business Connect').length).toBeGreaterThan(0)
  expect(screen.queryByText('掲載先を手動記録')).not.toBeInTheDocument()
})
