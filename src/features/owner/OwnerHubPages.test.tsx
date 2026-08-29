import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../shared/i18n'
import { beforeEach, expect, test, vi } from 'vitest'
import type * as AuthModule from '../auth/auth-context'
import type * as OwnerApiModule from './owner-api'
import { AnalyzeHubPage, CollectHubPage, MeoHubPage, SettingsHubPage } from './OwnerHubPages'

const storeId = '44444444-4444-4444-8444-444444444444'

const apiMocks = vi.hoisted(() => ({
  getAiConnection: vi.fn(),
  getOwnerStore: vi.fn(),
  getMeoCapabilities: vi.fn(),
  getMonthlySummary: vi.fn(),
  getSurveyConfig: vi.fn(),
}))

vi.mock('./owner-api', async () => {
  const actual = await vi.importActual<typeof OwnerApiModule>('./owner-api')
  return { ...actual, ...apiMocks }
})

vi.mock('../auth/auth-context', async () => {
  const actual = await vi.importActual<typeof AuthModule>('../auth/auth-context')
  return {
    ...actual,
    useAuth: () => ({ user: { email: 'owner@example.com' } }),
  }
})

vi.mock('../meo/meo-api', () => ({
  meoFeatureCapabilitiesQueryOptions: () => ({
    queryKey: ['meo-feature-capabilities'],
    queryFn: apiMocks.getMeoCapabilities,
    retry: false,
  }),
}))

vi.mock('./survey-config-api', () => ({ getSurveyConfig: apiMocks.getSurveyConfig }))

vi.mock('./OwnerAnimatedIcon', () => ({
  OwnerAnimatedIcon: ({ name, className }: { name: string; className?: string }) => (
    <svg
      aria-hidden="true"
      className={className}
      data-testid={`owner-animated-icon-${name}`}
    />
  ),
  OwnerIconMotion: ({ children }: { children: ReactElement }) => (
    <span data-testid="owner-icon-motion">{children}</span>
  ),
}))

beforeEach(() => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  vi.clearAllMocks()
  apiMocks.getOwnerStore.mockResolvedValue({ status: 'draft' })
  apiMocks.getAiConnection.mockResolvedValue(null)
  apiMocks.getMonthlySummary.mockResolvedValue({ started: 1234, completion_rate: 75 })
  apiMocks.getSurveyConfig.mockResolvedValue({ questions: [] })
  apiMocks.getMeoCapabilities.mockResolvedValue({
    serverTime: '2026-08-18T01:00:00.000Z',
    features: [
      { key: 'instagram_to_gbp', title: 'Instagram投稿の再利用', status: 'available', releaseAt: '2026-08-18T01:00:00.000Z', executionMode: 'native', reason: null },
      { key: 'gbp_health', title: 'プロフィール診断', status: 'available', releaseAt: '2026-08-18T01:00:00.000Z', executionMode: 'native', reason: null },
      { key: 'gbp_insights', title: 'Googleマップ分析', status: 'coming_soon', releaseAt: '2026-08-25T01:00:00.000Z', executionMode: 'native', reason: null },
      { key: 'meo_rank', title: '順位チェック', status: 'coming_soon', releaseAt: '2026-09-01T01:00:00.000Z', executionMode: 'owner_provider', reason: null },
      { key: 'review_reply', title: '口コミ返信', status: 'paused', releaseAt: '2026-09-08T01:00:00.000Z', executionMode: 'owner_provider', reason: null },
    ],
  })
})

function renderSettingsHub() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/settings`]}>
        <Routes>
          <Route path="/dashboard/stores/:storeId/settings" element={<SettingsHubPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

function renderMeoHub() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/meo`]}>
        <Routes><Route path="/dashboard/stores/:storeId/meo" element={<MeoHubPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

function renderHub(path: 'collect' | 'analyze', element: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/${path}`]}>
        <Routes><Route path={`/dashboard/stores/:storeId/${path}`} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

test('設定ハブに開発者向けAIエージェント設定を表示しない', async () => {
  renderSettingsHub()

  const storeLink = await screen.findByRole('link', { name: /店舗情報/ })
  expect(screen.queryByRole('link', { name: /AIエージェント設定/ })).not.toBeInTheDocument()
  expect(storeLink.parentElement).toHaveAttribute('data-testid', 'owner-icon-motion')
  expect(within(storeLink).getByTestId('owner-animated-icon-store')).toBeInTheDocument()
  expect(within(storeLink).getByTestId('owner-animated-icon-chevron-right')).toBeInTheDocument()
})

test('設定ハブは現在選択中のAI接続を表示する', async () => {
  apiMocks.getAiConnection.mockResolvedValue({
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    status: 'active',
    keyLast4: '1234',
  })
  renderSettingsHub()

  expect(await screen.findByText('Gemini 接続済み')).toBeVisible()
  expect(apiMocks.getAiConnection).toHaveBeenCalledWith(storeId)
})

test('Google集客ハブは公開順に並べ、利用できる機能だけをリンクにする', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/meo`]}>
        <Routes>
          <Route path="/dashboard/stores/:storeId/meo" element={<MeoHubPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )

  await screen.findByTestId('owner-hub-instagram_to_gbp')
  const nav = screen.getByRole('navigation', { name: 'Google集客メニュー' })
  const rows = within(nav).getAllByTestId(/^owner-hub-/u)
  expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
    'owner-hub-meo_workspace',
    'owner-hub-gbp_health',
    'owner-hub-instagram_to_gbp',
    'owner-hub-gbp_insights',
    'owner-hub-meo_rank',
    'owner-hub-review_reply',
  ])
  expect(within(nav).getByRole('link', { name: /MEO管理/ })).toHaveAttribute(
    'href',
    `/dashboard/stores/${storeId}/meo/workspace/profile`,
  )
  expect(within(nav).getByRole('link', { name: /Instagram投稿の再利用/ })).toHaveAttribute(
    'href',
    `/dashboard/stores/${storeId}/meo/instagram`,
  )
  expect(within(nav).getByRole('link', { name: /プロフィール診断/ })).toHaveAttribute(
    'href',
    `/dashboard/stores/${storeId}/meo/health`,
  )
  expect(within(nav).getByTestId('owner-hub-gbp_insights')).toHaveAttribute('aria-disabled', 'true')
  expect(within(nav).getByTestId('owner-hub-gbp_insights')).toHaveTextContent('8/25(火) 10:00')
  expect(within(nav).getByTestId('owner-hub-review_reply')).toHaveTextContent('一時停止中')
  expect(within(nav).getByTestId('owner-hub-gbp_insights').closest('[data-testid="owner-icon-motion"]')).toBeNull()
  expect(within(nav).getByTestId('owner-animated-icon-gbp_insights')).toBeInTheDocument()
})

test('English hubs localize server MEO titles, dates, and settings chrome', async () => {
  localStorage.setItem('kuchitoru.locale', 'en')
  apiMocks.getMeoCapabilities.mockResolvedValue({
    serverTime: '2026-08-18T01:00:00.000Z',
    features: [
      { key: 'review_reply', title: '口コミ返信', status: 'coming_soon', releaseAt: null, executionMode: 'owner_provider', reason: null },
      { key: 'gbp_insights', title: 'Googleマップ分析', status: 'coming_soon', releaseAt: '2026-08-25T01:00:00.000Z', executionMode: 'native', reason: null },
    ],
  })
  const meo = renderMeoHub()
  expect(await screen.findByText('Review replies')).toBeVisible()
  expect(screen.getByTestId('owner-hub-review_reply')).toHaveTextContent('Release date TBD')
  expect(screen.getByTestId('owner-hub-gbp_insights')).toHaveTextContent('Tue, 8/25, 10:00')
  expect(meo.container).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
  meo.unmount()

  const settings = renderSettingsHub()
  expect(await screen.findByRole('navigation', { name: 'Settings menu' })).toBeVisible()
  expect(settings.container).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
  settings.unmount()

  const collect = renderHub('collect', <CollectHubPage />)
  expect(await screen.findByRole('navigation', { name: 'Collect menu' })).toHaveTextContent('QR & share link')
  expect(collect.container).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
  collect.unmount()

  const analyze = renderHub('analyze', <AnalyzeHubPage />)
  const analyzeNav = await screen.findByRole('navigation', { name: 'Analyze menu' })
  expect(await within(analyzeNav).findByText('1,234 this month')).toBeVisible()
  expect(analyze.container).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
})
