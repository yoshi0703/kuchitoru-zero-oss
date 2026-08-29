import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import type * as AuthModule from '../auth/auth-context'
import { OwnerLayout } from './OwnerLayout'

const storeId = '44444444-4444-4444-8444-444444444444'
const staleStoreId = '22222222-2222-4222-8222-222222222222'
const apiMocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  getOwnerStores: vi.fn(),
}))

vi.mock('./owner-api', () => ({ getOwnerStores: apiMocks.getOwnerStores }))

vi.mock('../meo/meo-api', () => ({
  meoFeatureCapabilitiesQueryOptions: () => ({
    queryKey: ['meo-feature-capabilities'],
    queryFn: apiMocks.capabilities,
    retry: false,
  }),
}))

vi.mock('../auth/auth-context', async () => {
  const actual = await vi.importActual<typeof AuthModule>('../auth/auth-context')
  return {
    ...actual,
    useAuth: () => ({ user: { email: 'owner@example.com' }, signOut: vi.fn() }),
  }
})

function response(status: 'hidden' | 'coming_soon' | 'available' | 'paused') {
  return {
    serverTime: '2026-08-11T03:00:00.000Z',
    features: [{
      key: 'review_reply',
      title: '口コミ返信',
      status,
      releaseAt: status === 'coming_soon' ? '2026-09-08T01:00:00.000Z' : null,
      executionMode: 'native',
      reason: null,
    }],
  }
}

function LocationProbe() {
  const location = useLocation()
  return <span>{`${location.pathname}${location.search}${location.hash}`}</span>
}

function renderLayout(initialEntry = `/dashboard/stores/${storeId}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/dashboard/stores/:storeId/*" element={<OwnerLayout />}>
            <Route index element={<span>ホーム本文</span>} />
            <Route path="store" element={<LocationProbe />} />
          </Route>
          <Route path="/dashboard" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  apiMocks.getOwnerStores.mockResolvedValue([{ id: storeId, name: 'テスト店', owner_store_slot: 1 }])
  apiMocks.capabilities.mockResolvedValue(response('hidden'))
})

test('English desktop and mobile navigation localizes MEO titles and store controls', async () => {
  localStorage.setItem('kuchitoru.locale', 'en')
  apiMocks.getOwnerStores.mockResolvedValue([{ id: storeId, name: 'Harbor Cafe', owner_store_slot: 1 }])
  apiMocks.capabilities.mockResolvedValue({
    serverTime: '2026-08-11T03:00:00.000Z',
    features: [{
      key: 'review_reply', title: '口コミ返信', status: 'coming_soon', releaseAt: null,
      executionMode: 'owner_provider', reason: null,
    }],
  })
  const { container } = renderLayout()
  expect(await screen.findByTestId('owner-nav-review_reply')).toHaveTextContent('Review replies')
  expect(screen.getByRole('combobox', { name: 'Store to manage' })).toHaveDisplayValue('Harbor Cafe')
  expect(screen.getByRole('navigation', { name: 'Primary management menu' })).toHaveTextContent('Growth')
  expect(container.querySelector('.owner-sidebar')).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
  expect(container.querySelector('.owner-topbar')).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
  expect(container.querySelector('.owner-tabbar')).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
})

test('公開設定に関係なく無料のMEO管理だけは常に利用できる', async () => {
  renderLayout()
  expect(await screen.findByText('ホーム本文')).toBeVisible()
  await vi.waitFor(() => expect(apiMocks.capabilities).toHaveBeenCalled())
  expect(screen.queryByTestId('owner-nav-review_reply')).not.toBeInTheDocument()
  expect(screen.getByTestId('owner-nav-meo_workspace')).toHaveAttribute(
    'href',
    `/dashboard/stores/${storeId}/meo/workspace/profile`,
  )
  const homeNav = screen.getByTestId('owner-nav-home')
  const qrNav = screen.getByTestId('owner-nav-qr')
  expect(homeNav).toHaveAttribute('data-owner-icon-active', 'true')
  expect(homeNav).toHaveAttribute('data-owner-icon-motion', 'enabled')
  expect(homeNav.querySelector('[data-owner-icon-name="home"]')).toHaveAttribute(
    'data-owner-icon-source',
    'animate-ui',
  )
  expect(screen.getByTestId('owner-nav-meo_workspace').querySelector('[data-owner-icon-name="meo-workspace"]')).toHaveAttribute(
    'data-owner-icon-source',
    'animate-ui',
  )
  fireEvent.focus(qrNav)
  expect(qrNav).toHaveAttribute('data-owner-icon-focus', 'true')
  fireEvent.blur(qrNav)
  expect(qrNav).toHaveAttribute('data-owner-icon-focus', 'false')
  expect(screen.getByText('Google集客')).toBeVisible()
})

test('availableの機能だけリンクとして操作できる', async () => {
  apiMocks.capabilities.mockResolvedValue(response('available'))
  renderLayout()
  const nav = await screen.findByTestId('owner-nav-review_reply')
  expect(nav).toHaveAttribute('href', `/dashboard/stores/${storeId}/meo/review-reply`)
  expect(nav).not.toHaveAttribute('aria-disabled', 'true')
  const mobileNav = screen.getByRole('navigation', { name: '管理画面の主要メニュー' })
  expect(within(mobileNav).getByRole('link', { name: '集客' })).toHaveAttribute(
    'href',
    `/dashboard/stores/${storeId}/meo`,
  )
  expect(within(mobileNav).queryByText('Google集客')).not.toBeInTheDocument()
})

test('coming_soonは見えるがリンクにならない', async () => {
  apiMocks.capabilities.mockResolvedValue(response('coming_soon'))
  renderLayout()
  const nav = await screen.findByTestId('owner-nav-review_reply')
  expect(nav.tagName).toBe('SPAN')
  expect(nav).toHaveAttribute('aria-disabled', 'true')
  expect(nav).toHaveAttribute('data-owner-icon-motion', 'disabled')
  expect(nav.querySelector('[data-owner-icon-name="interviews"]')).toHaveAttribute(
    'data-owner-icon-source',
    'animate-ui',
  )
  expect(nav).toHaveTextContent('2026/09/08')
  const mobileNav = screen.getByRole('navigation', { name: '管理画面の主要メニュー' })
  expect(within(mobileNav).queryByText('Google集客')).not.toBeInTheDocument()
})

test('公開予定は日付順に並び、直近だけを強調する', async () => {
  apiMocks.capabilities.mockResolvedValue({
    serverTime: '2026-08-11T09:00:00.000Z',
    features: [
      { key: 'review_reply', title: '口コミ返信', status: 'coming_soon', releaseAt: '2026-09-08T01:00:00.000Z', executionMode: 'owner_provider', reason: null },
      { key: 'meo_rank', title: '順位チェック', status: 'coming_soon', releaseAt: '2026-09-01T01:00:00.000Z', executionMode: 'owner_provider', reason: null },
      { key: 'gbp_insights', title: 'Googleマップ分析', status: 'coming_soon', releaseAt: '2026-08-25T01:00:00.000Z', executionMode: 'native', reason: null },
      { key: 'gbp_health', title: 'プロフィール診断', status: 'coming_soon', releaseAt: '2026-08-18T01:00:00.000Z', executionMode: 'native', reason: null },
      { key: 'instagram_to_gbp', title: 'Instagram投稿の再利用', status: 'coming_soon', releaseAt: '2026-08-18T01:00:00.000Z', executionMode: 'native', reason: null },
    ],
  })
  renderLayout()

  await screen.findByTestId('owner-nav-instagram_to_gbp')
  const roadmap = screen.getAllByTestId(/^owner-nav-/u)
  expect(roadmap.map((item) => item.getAttribute('data-testid'))).toEqual([
    'owner-nav-home',
    'owner-nav-qr',
    'owner-nav-survey',
    'owner-nav-interviews',
    'owner-nav-summary',
    'owner-nav-store',
    'owner-nav-connections',
    'owner-nav-ai',
    'owner-nav-account',
    'owner-nav-meo_workspace',
    'owner-nav-gbp_health',
    'owner-nav-instagram_to_gbp',
    'owner-nav-gbp_insights',
    'owner-nav-meo_rank',
    'owner-nav-review_reply',
  ])
})

test('pausedは見えるがリンクにならない', async () => {
  apiMocks.capabilities.mockResolvedValue(response('paused'))
  renderLayout()
  const nav = await screen.findByTestId('owner-nav-review_reply')
  expect(nav.tagName).toBe('SPAN')
  expect(nav).toHaveAttribute('aria-disabled', 'true')
  expect(nav).toHaveTextContent('一時停止中')
})

test('URLの店舗IDが自分の店舗にない場合はslot 1店舗へ同じページで戻す', async () => {
  renderLayout(`/dashboard/stores/${staleStoreId}/store?tab=basic#name`)

  expect(await screen.findByText(`/dashboard/stores/${storeId}/store?tab=basic#name`)).toBeVisible()
})
