import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { I18nProvider } from '../../shared/i18n'
import { beforeEach, expect, test, vi } from 'vitest'
import type * as OwnerApiModule from './owner-api'
import { LegacyOwnerRouteRedirect } from './LegacyOwnerRouteRedirect'

const apiMocks = vi.hoisted(() => ({
  getOwnerStores: vi.fn(),
}))

vi.mock('./owner-api', async () => {
  const actual = await vi.importActual<typeof OwnerApiModule>('./owner-api')
  return { ...actual, ...apiMocks }
})

function LocationProbe() {
  const location = useLocation()
  return <div>{`${location.pathname}${location.search}${location.hash}`}</div>
}

function renderRedirect(initialEntry: string, routePath: string, suffix: string, includeLegacyId = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path={routePath}
            element={<LegacyOwnerRouteRedirect suffix={suffix} includeLegacyId={includeLegacyId} />}
          />
          <Route path="/dashboard/stores/:storeId/*" element={<LocationProbe />} />
          <Route path="/dashboard" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  vi.clearAllMocks()
  apiMocks.getOwnerStores.mockResolvedValue([
    {
      id: '55555555-5555-4555-8555-555555555555',
      owner_store_slot: 2,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      owner_store_slot: 1,
    },
  ])
})

test('旧ダッシュボードURLをslot 1へ移しqueryとhashを維持する', async () => {
  renderRedirect('/dashboard/summary?month=2026-08#metrics', '/dashboard/summary', '/summary')

  expect(await screen.findByText(
    '/dashboard/stores/44444444-4444-4444-8444-444444444444/summary?month=2026-08#metrics',
  )).toBeVisible()
})

test('旧回答詳細URLの回答IDを店舗スコープ内へ引き継ぐ', async () => {
  renderRedirect(
    '/dashboard/interviews/33333333-3333-4333-8333-333333333333',
    '/dashboard/interviews/:id',
    '/interviews',
    true,
  )

  expect(await screen.findByText(
    '/dashboard/stores/44444444-4444-4444-8444-444444444444/interviews/33333333-3333-4333-8333-333333333333',
  )).toBeVisible()
})

test('店舗一覧を取得できない場合は店舗選択へ戻す', async () => {
  apiMocks.getOwnerStores.mockRejectedValue(new Error('network error'))
  renderRedirect('/dashboard/ai', '/dashboard/ai', '/ai')

  expect(await screen.findByText('/dashboard')).toBeVisible()
})

test('English legacy redirect loading state has localized accessibility copy', () => {
  localStorage.setItem('kuchitoru.locale', 'en')
  apiMocks.getOwnerStores.mockReturnValue(new Promise(() => undefined))
  const { container } = renderRedirect('/dashboard/summary', '/dashboard/summary', '/summary')
  expect(screen.getByText('Checking store information')).toBeVisible()
  expect(container).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
})
