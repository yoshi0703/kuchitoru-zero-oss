import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { MeoFeatureRoute } from './MeoFeatureRoute'

const testI18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))
vi.mock('../../shared/i18n', () => ({ useI18n: () => ({ locale: testI18n.locale }) }))

const storeId = '44444444-4444-4444-8444-444444444444'
const capabilitiesMock = vi.hoisted(() => vi.fn())

vi.mock('./meo-api', () => ({
  meoFeatureCapabilitiesQueryOptions: (scopedStoreId: string) => ({
    queryKey: ['meo-feature-capabilities', scopedStoreId],
    queryFn: capabilitiesMock,
    retry: false,
  }),
}))

function LocationView() {
  return <span>現在地:{useLocation().pathname}</span>
}

function response(status: 'hidden' | 'coming_soon' | 'available' | 'paused') {
  return {
    serverTime: '2026-08-11T03:00:00.000Z',
    features: [{
      key: 'gbp_insights',
      title: 'Googleマップ分析',
      status,
      releaseAt: status === 'coming_soon' ? '2026-08-18T00:00:00.000Z' : null,
      executionMode: 'native',
      reason: status === 'paused' ? '安全確認のため停止中です。' : null,
    }],
  }
}

function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/meo/insights`]}>
        <Routes>
          <Route path="/dashboard/stores/:storeId" element={<LocationView />} />
          <Route
            path="/dashboard/stores/:storeId/meo/insights"
            element={<MeoFeatureRoute featureKey="gbp_insights"><button>分析する</button></MeoFeatureRoute>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  testI18n.locale = 'ja'
  capabilitiesMock.mockResolvedValue(response('hidden'))
})

test('hiddenの直接URLは店舗ホームへ戻す', async () => {
  renderRoute()
  expect(await screen.findByText(`現在地:/dashboard/stores/${storeId}`)).toBeVisible()
  expect(screen.queryByRole('button', { name: '分析する' })).not.toBeInTheDocument()
})

test('coming_soonは公開予定だけを表示し、購入導線を出さない', async () => {
  capabilitiesMock.mockResolvedValue(response('coming_soon'))
  renderRoute()
  expect(await screen.findByRole('heading', { name: '現在準備中です' })).toBeVisible()
  expect(screen.getByText(/2026年8月18日/)).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('pausedは理由だけ表示して実操作を描画しない', async () => {
  capabilitiesMock.mockResolvedValue(response('paused'))
  renderRoute()
  expect(await screen.findByRole('heading', { name: 'ただいま一時停止しています' })).toBeVisible()
  expect(screen.getByText('安全確認のため停止中です。')).toBeVisible()
  expect(screen.queryByRole('button', { name: '分析する' })).not.toBeInTheDocument()
})

test('availableだけ実操作を描画する', async () => {
  capabilitiesMock.mockResolvedValue(response('available'))
  renderRoute()
  expect(await screen.findByRole('button', { name: '分析する' })).toBeVisible()
})
