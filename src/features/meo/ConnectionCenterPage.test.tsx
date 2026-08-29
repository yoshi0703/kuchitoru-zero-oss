import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '../../shared/api/http'
import { ConnectionCenterPage } from './ConnectionCenterPage'

const testI18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))
vi.mock('../../shared/i18n', () => ({ useI18n: () => ({ locale: testI18n.locale }) }))
import { loadMeoOauthProof, saveMeoOauthProof } from './meo-oauth-browser'

const STORE_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_STORE_ID = '55555555-5555-4555-8555-555555555555'
const OAUTH_STATE = 's'.repeat(43)
const VERIFIER = 'v'.repeat(43)
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  complete: vi.fn(),
  connections: vi.fn(),
  disconnect: vi.fn(),
  externalWrites: vi.fn(),
  locations: vi.fn(),
  saveDataForSeo: vi.fn(),
  setExternalWrites: vi.fn(),
  selectLocation: vi.fn(),
  start: vi.fn(),
}))

vi.mock('./meo-api', () => ({
  meoFeatureCapabilitiesQueryOptions: () => ({
    queryKey: ['meo-feature-capabilities'],
    queryFn: mocks.capabilities,
    retry: false,
  }),
}))

vi.mock('./meo-service-api', () => ({
  completeMeoOauthConnection: mocks.complete,
  disconnectMeoProvider: mocks.disconnect,
  getGoogleBusinessLocations: mocks.locations,
  getMeoConnections: mocks.connections,
  getMeoExternalWriteSettings: mocks.externalWrites,
  saveDataForSeoConnection: mocks.saveDataForSeo,
  selectGoogleBusinessLocation: mocks.selectLocation,
  startMeoOauthConnection: mocks.start,
  updateMeoExternalWriteSettings: mocks.setExternalWrites,
}))

function LocationProbe() {
  return <output data-testid="location-search">{useLocation().search}</output>
}

function renderPage(initialEntry = `/dashboard/stores/${STORE_ID}/connections`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/dashboard/stores/:storeId/connections"
            element={<><ConnectionCenterPage /><LocationProbe /></>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function seedOauthProof(storeId = STORE_ID, provider: 'google_business' | 'instagram' = 'instagram') {
  saveMeoOauthProof({
    storeId,
    provider,
    verifier: VERIFIER,
    expectedState: OAUTH_STATE,
    idempotencyKey: IDEMPOTENCY_KEY,
    createdAt: Date.now(),
  })
}

function setOauthCallbackFragment(provider: string, state = OAUTH_STATE, code = 'authorization-code') {
  window.location.hash = new URLSearchParams({
    connection: 'oauth_callback',
    provider,
    state,
    code,
  }).toString()
}

beforeEach(() => {
  testI18n.locale = 'ja'
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
  window.sessionStorage.clear()
  mocks.connections.mockResolvedValue([])
  mocks.externalWrites.mockResolvedValue({ enabled: false, canManage: true, canExecute: true })
  mocks.locations.mockResolvedValue([])
  mocks.setExternalWrites.mockResolvedValue({ enabled: true, canManage: true, canExecute: true })
  mocks.complete.mockResolvedValue({ connected: true, selectLocation: false })
  mocks.capabilities.mockResolvedValue({
    serverTime: '2026-08-11T03:00:00.000Z',
    features: [
      { key: 'review_reply', title: '口コミ返信', status: 'hidden', releaseAt: null, executionMode: 'owner_provider', reason: null },
      { key: 'meo_rank', title: '順位', status: 'hidden', releaseAt: null, executionMode: 'owner_provider', reason: null },
      { key: 'gbp_insights', title: '分析', status: 'hidden', releaseAt: null, executionMode: 'native', reason: null },
      { key: 'gbp_health', title: 'プロフィール診断', status: 'hidden', releaseAt: null, executionMode: 'native', reason: null },
      { key: 'instagram_to_gbp', title: 'Instagram', status: 'hidden', releaseAt: null, executionMode: 'native', reason: null },
    ],
  })
})

test('English connection presentation localizes states and actions without changing provider values', async () => {
  testI18n.locale = 'en'
  mocks.capabilities.mockResolvedValue({ serverTime: '2026-08-11T03:00:00.000Z', features: [{ key: 'review_reply', title: '口コミ返信', status: 'available', releaseAt: null, executionMode: 'native', reason: null }] })
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Google Business Profile' })).toBeVisible()
  expect(screen.getByText('Not connected')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(screen.getByRole('heading', { name: 'AI connection' })).toBeVisible()
})

test('店舗管理者は外部書き込みを有効にでき、更新APIへmutation keyを送る', async () => {
  renderPage()

  const externalWrites = await screen.findByRole('switch', {
    name: 'Googleへの返信と投稿を許可',
  })
  await waitFor(() => expect(externalWrites).toBeEnabled())
  expect(externalWrites).not.toBeChecked()

  fireEvent.click(externalWrites)

  await waitFor(() => expect(mocks.setExternalWrites).toHaveBeenCalledWith(
    STORE_ID,
    true,
    expect.stringMatching(/^[0-9a-f-]{36}$/u),
  ))
  await waitFor(() => expect(externalWrites).toBeChecked())
  expect(screen.getByText('外部サービスへの書き込みを有効にしました。')).toBeVisible()
})

test('変更権限がない利用者には外部書き込み設定を表示するが操作させない', async () => {
  mocks.externalWrites.mockResolvedValue({ enabled: true, canManage: false, canExecute: true })
  renderPage()

  const externalWrites = await screen.findByRole('switch', {
    name: 'Googleへの返信と投稿を許可',
  })
  await waitFor(() => expect(externalWrites).toBeChecked())
  expect(externalWrites).toBeDisabled()
  expect(screen.getByText('この設定を変更できるのは、店舗のオーナーまたは管理者です。')).toBeVisible()
  expect(mocks.setExternalWrites).not.toHaveBeenCalled()
})

test('外部書き込み設定を取得できない場合は操作を無効にする', async () => {
  mocks.externalWrites.mockRejectedValue(new Error('network'))
  renderPage()

  expect(await screen.findByText('外部書き込みの設定を取得できないため、変更できません。')).toBeVisible()
  expect(screen.getByRole('switch', { name: 'Googleへの返信と投稿を許可' })).toBeDisabled()
  expect(mocks.setExternalWrites).not.toHaveBeenCalled()
})

test('未公開機能の新規接続は表示せず既存接続の安全確認だけ取得する', async () => {
  renderPage()
  expect(await screen.findByRole('heading', { name: 'AI接続' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Googleビジネスプロフィール' })).not.toBeInTheDocument()
  await waitFor(() => expect(mocks.connections).toHaveBeenCalledWith(STORE_ID))
})

test('公開対象に必要な接続だけを平易な文言で表示する', async () => {
  mocks.capabilities.mockResolvedValue({
    serverTime: '2026-08-11T03:00:00.000Z',
    features: [
      { key: 'meo_rank', title: '順位', status: 'coming_soon', releaseAt: null, executionMode: 'owner_provider', reason: null },
      { key: 'instagram_to_gbp', title: 'Instagram', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
    ],
  })
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Googleビジネスプロフィール' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Instagram' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'DataForSEO' })).toBeVisible()
  expect(screen.getAllByText('未接続')).toHaveLength(3)
})

test('接続開始はSHA-256 challengeだけをAPIへ送り失敗時にverifierを残さない', async () => {
  mocks.capabilities.mockResolvedValue({
    serverTime: '2026-08-11T03:00:00.000Z',
    features: [
      { key: 'review_reply', title: '口コミ返信', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
    ],
  })
  mocks.start.mockRejectedValue(new Error('接続を開始できませんでした。'))
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: '接続する' }))

  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  expect(mocks.start).toHaveBeenCalledWith(STORE_ID, 'google_business', {
    challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
  })
  expect(loadMeoOauthProof(STORE_ID, 'google_business')).toBeNull()
})

test('OAuth callbackは同じ店舗とproviderのverifierで一度だけ完了しURLと保存値を消す', async () => {
  seedOauthProof()
  setOauthCallbackFragment('instagram')
  let finishComplete!: (value: { connected: true; selectLocation: boolean }) => void
  mocks.complete.mockImplementation(() => {
    expect(window.location.hash).toBe('')
    return new Promise((resolve) => {
      finishComplete = resolve
    })
  })
  renderPage()

  await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(
    STORE_ID,
    'instagram',
    { state: OAUTH_STATE, code: 'authorization-code', verifier: VERIFIER },
    IDEMPOTENCY_KEY,
  ))
  expect(window.location.hash).toBe('')

  finishComplete({ connected: true, selectLocation: false })
  await waitFor(() => expect(loadMeoOauthProof(STORE_ID, 'instagram')).toBeNull())
  expect(mocks.complete).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('?connection=connected&provider=instagram'))
  expect(screen.getByTestId('location-search')).not.toHaveTextContent('state=')
  expect(screen.getByTestId('location-search')).not.toHaveTextContent('code=')
})

test('OAuth完了APIが失敗してもURLとverifierを消して自動再送しない', async () => {
  seedOauthProof()
  setOauthCallbackFragment('instagram')
  mocks.complete.mockRejectedValue(new Error('network'))
  renderPage()

  expect(await screen.findByText(/自動では再送していません/u)).toBeVisible()
  expect(mocks.complete).toHaveBeenCalledTimes(1)
  expect(loadMeoOauthProof(STORE_ID, 'instagram')).toBeNull()
  expect(window.location.hash).toBe('')
})

test('OAuth保存後のusage確定失敗は再接続を促さず接続状態をreadbackする', async () => {
  seedOauthProof(STORE_ID, 'google_business')
  setOauthCallbackFragment('google_business')
  mocks.complete.mockRejectedValue(new ApiError({
    code: 'PROVIDER_RESULT_SETTLEMENT_FAILED',
    message: '外部サービスの取得結果を記録できませんでした。',
    status: 503,
    retryable: true,
  }))
  mocks.connections
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{
      provider: 'google_business',
      status: 'active',
      displayName: 'ステージング確認店',
      locationName: 'accounts/a/locations/l',
      expiresAt: '2026-08-12T12:00:00.000Z',
      connectedAt: '2026-08-12T00:00:00.000Z',
      safeErrorCode: null,
    }])
  renderPage()

  expect(await screen.findByText(/再接続せず/u)).toBeVisible()
  await waitFor(() => expect(mocks.connections).toHaveBeenCalledTimes(2))
  expect(mocks.complete).toHaveBeenCalledTimes(1)
  expect(loadMeoOauthProof(STORE_ID, 'google_business')).toBeNull()
  expect(window.location.hash).toBe('')
  expect(screen.getByTestId('location-search')).toHaveTextContent('connection=attention_required')
})

test.each([
  {
    label: 'provider違い',
    proofStoreId: STORE_ID,
    proofProvider: 'instagram' as const,
    callbackProvider: 'google_business',
    expectedError: /別の店舗またはサービス用/u,
  },
  {
    label: '店舗違い',
    proofStoreId: OTHER_STORE_ID,
    proofProvider: 'instagram' as const,
    callbackProvider: 'instagram',
    expectedError: /別の店舗またはサービス用/u,
  },
  {
    label: 'provider欠落',
    proofStoreId: STORE_ID,
    proofProvider: 'instagram' as const,
    callbackProvider: '',
    expectedError: /安全確認ができなかった/u,
  },
])('$labelのOAuth callbackはfail closedでAPIを呼ばず保存値を消す', async ({
  proofStoreId,
  proofProvider,
  callbackProvider,
  expectedError,
}) => {
  seedOauthProof(proofStoreId, proofProvider)
  setOauthCallbackFragment(callbackProvider)
  renderPage()

  expect(await screen.findByText(expectedError)).toBeVisible()
  expect(mocks.complete).not.toHaveBeenCalled()
  expect(loadMeoOauthProof(proofStoreId, proofProvider)).toBeNull()
  expect(window.location.hash).toBe('')
})

test('verifierがないOAuth callbackはfail closedでAPIを呼ばずURLを消す', async () => {
  setOauthCallbackFragment('instagram')
  renderPage()

  expect(await screen.findByText(/安全確認ができなかった/u)).toBeVisible()
  expect(mocks.complete).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('')
})

test('query形式のOAuth callbackは受け入れずAPI未送信でURLとverifierを消す', async () => {
  seedOauthProof()
  renderPage(`/dashboard/stores/${STORE_ID}/connections?connection=oauth_callback&provider=instagram&state=${OAUTH_STATE}&code=authorization-code`)

  expect(await screen.findByText(/URLの形式が違う接続/u)).toBeVisible()
  expect(mocks.complete).not.toHaveBeenCalled()
  expect(loadMeoOauthProof(STORE_ID, 'instagram')).toBeNull()
  expect(screen.getByTestId('location-search')).toHaveTextContent('?connection=failed')
  expect(screen.getByTestId('location-search')).not.toHaveTextContent('state=')
  expect(screen.getByTestId('location-search')).not.toHaveTextContent('code=')
})

test('fragmentをhistoryから消せない場合はOAuth完了APIを呼ばない', async () => {
  seedOauthProof()
  setOauthCallbackFragment('instagram')
  const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    throw new Error('blocked')
  })

  renderPage()

  expect(await screen.findByText(/URLから接続情報を消せなかった/u)).toBeVisible()
  expect(mocks.complete).not.toHaveBeenCalled()
  expect(loadMeoOauthProof(STORE_ID, 'instagram')).toBeNull()
  replaceState.mockRestore()
})

test('機能が非公開でも既存Instagram接続と投稿前確認の方針を表示する', async () => {
  mocks.connections.mockResolvedValue([{
    provider: 'instagram',
    status: 'active',
    displayName: 'kuchitoru_zero',
    locationName: null,
    expiresAt: null,
    connectedAt: '2026-08-11T03:00:00.000Z',
    safeErrorCode: null,
  }])
  renderPage()

  const heading = await screen.findByRole('heading', { name: 'Instagram' })
  const panel = heading.closest('.meo-connection-card') as HTMLElement
  expect(within(panel).getByText('投稿を読み込みます。Googleへの公開には毎回確認が必要です')).toBeVisible()
  expect(within(panel).queryByRole('button', { name: '再接続する' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: '解除' })).not.toBeInTheDocument()
})
