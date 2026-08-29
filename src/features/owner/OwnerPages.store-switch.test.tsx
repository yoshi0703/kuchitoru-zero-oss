import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { AI_PROVIDER_CATALOG } from '../../shared/ai-providers'
import type * as OwnerApiModule from './owner-api'
import type { AiConnection, InterviewRow, StoreRecord } from './owner-api'
import { AiConnectionPage, InterviewsPage, QrPage, StorePage } from './OwnerPages'

const firstStoreId = '44444444-4444-4444-8444-444444444444'
const secondStoreId = '55555555-5555-4555-8555-555555555555'

const apiMocks = vi.hoisted(() => ({
  getAiConnection: vi.fn(),
  getAiConnections: vi.fn(),
  getAllInterviewRows: vi.fn(),
  getInterviewHistory: vi.fn(),
  getOwnerStore: vi.fn(),
  getSurveyRevisions: vi.fn(),
  revalidateAiConnection: vi.fn(),
  saveOwnerStore: vi.fn(),
}))
const qrMocks = vi.hoisted(() => ({
  toDataURL: vi.fn(),
}))

vi.mock('./owner-api', async () => {
  const actual = await vi.importActual<typeof OwnerApiModule>('./owner-api')
  return { ...actual, ...apiMocks }
})
vi.mock('qrcode', () => ({ default: { toDataURL: qrMocks.toDataURL } }))

const interviewRow: InterviewRow = {
  id: '66666666-6666-4666-8666-666666666666',
  created_at: '2026-08-01T00:00:00.000Z',
  status: 'completed',
  rating: 5,
  visit_frequency: null,
  generation_status: 'succeeded',
  generated_review: '良い体験でした。',
  edited_review: null,
  generation_provider: 'openai',
  google_handoff_opened_at: null,
  completed_at: '2026-08-01T00:05:00.000Z',
  survey_revision: 1,
  structured_answers_json: {},
}

function storeRecord(id: string, name: string): StoreRecord {
  return {
    id,
    owner_store_slot: id === firstStoreId ? 1 : 2,
    public_slug: id === firstStoreId ? 'store-a' : 'store-b',
    name,
    industry: 'カフェ',
    address: '',
    description: '',
    website_url: null,
    welcome_message: '',
    closing_message: '',
    google_review_url: null,
    google_place_id: null,
    status: 'draft',
    archived_at: null,
  }
}

const activeConnection: AiConnection = {
  provider: 'openai',
  model: AI_PROVIDER_CATALOG.openai.defaultModel,
  status: 'active',
  keyLast4: '1234',
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function SwitchStoreButton({ path }: { path: string }) {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(`/dashboard/stores/${secondStoreId}${path}`)}>店舗を切り替える</button>
}

function renderSwitchablePage(path: string, element: React.ReactNode, locale: 'ja' | 'en' = 'ja') {
  window.localStorage.setItem('kuchitoru.locale', locale)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider><MemoryRouter initialEntries={[`/dashboard/stores/${firstStoreId}${path}`]}>
        <Routes>
          <Route
            path={`/dashboard/stores/:storeId${path}`}
            element={<><SwitchStoreButton path={path} />{element}</>}
          />
        </Routes>
      </MemoryRouter></I18nProvider>
    </QueryClientProvider>,
  )
}

test('英語のQRと店舗情報ページは店舗データを保ったままクロームを翻訳する', async () => {
  const qrPage = renderSwitchablePage('/qr', <QrPage />, 'en')
  expect(await screen.findByRole('heading', { name: '店舗A' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'QR code and share link' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copy URL' })).toBeVisible()
  expect(screen.queryByText('URLをコピー')).not.toBeInTheDocument()
  qrPage.unmount()

  renderSwitchablePage('/store', <StorePage />, 'en')
  expect(await screen.findByDisplayValue('店舗A')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Store information' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible()
  expect(screen.queryByText('店舗名')).not.toBeInTheDocument()
})

beforeEach(() => {
  vi.clearAllMocks()
  qrMocks.toDataURL.mockReset()
  qrMocks.toDataURL.mockResolvedValue('data:image/png;base64,qr')
  apiMocks.getAiConnection.mockResolvedValue(activeConnection)
  apiMocks.getAiConnections.mockResolvedValue([activeConnection])
  apiMocks.getAllInterviewRows.mockResolvedValue([interviewRow])
  apiMocks.getSurveyRevisions.mockResolvedValue([])
  apiMocks.getOwnerStore.mockImplementation((storeId: string) => Promise.resolve(
    storeId === firstStoreId ? storeRecord(firstStoreId, '店舗A') : storeRecord(secondStoreId, '店舗B'),
  ))
  apiMocks.revalidateAiConnection.mockResolvedValue(activeConnection)
  apiMocks.saveOwnerStore.mockResolvedValue(storeRecord(firstStoreId, '店舗A'))
})

test('店舗を切り替えると旧店舗のQRを即時に消して新店舗の生成完了を待つ', async () => {
  const user = userEvent.setup()
  const secondQr = deferred<string>()
  qrMocks.toDataURL
    .mockResolvedValueOnce('data:image/png;base64,store-a')
    .mockReturnValueOnce(secondQr.promise)
  renderSwitchablePage('/qr', <QrPage />)

  expect(await screen.findByRole('img', { name: /store-aのQRコード/ })).toHaveAttribute(
    'src',
    'data:image/png;base64,store-a',
  )

  await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))

  expect(screen.queryByRole('img', { name: /store-aのQRコード/ })).not.toBeInTheDocument()
  await waitFor(() => expect(qrMocks.toDataURL).toHaveBeenCalledWith(
    expect.stringContaining('/s/store-b'),
    expect.any(Object),
  ))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()

  await act(async () => secondQr.resolve('data:image/png;base64,store-b'))
  expect(await screen.findByRole('img', { name: /store-bのQRコード/ })).toHaveAttribute(
    'src',
    'data:image/png;base64,store-b',
  )
})

test('店舗切替前に開始したQR生成の遅延結果を新店舗へ表示しない', async () => {
  const user = userEvent.setup()
  const firstQr = deferred<string>()
  const secondQr = deferred<string>()
  qrMocks.toDataURL
    .mockReturnValueOnce(firstQr.promise)
    .mockReturnValueOnce(secondQr.promise)
  renderSwitchablePage('/qr', <QrPage />)

  await waitFor(() => expect(qrMocks.toDataURL).toHaveBeenCalledWith(
    expect.stringContaining('/s/store-a'),
    expect.any(Object),
  ))
  await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))
  await waitFor(() => expect(qrMocks.toDataURL).toHaveBeenCalledTimes(2))

  await act(async () => firstQr.resolve('data:image/png;base64,late-store-a'))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()

  await act(async () => secondQr.resolve('data:image/png;base64,store-b'))
  expect(await screen.findByRole('img', { name: /store-bのQRコード/ })).toHaveAttribute(
    'src',
    'data:image/png;base64,store-b',
  )
})

test('店舗を切り替えると回答履歴のカーソルと前ページ履歴を破棄する', async () => {
  const user = userEvent.setup()
  const nextCursor = { createdAt: '2026-07-01T00:00:00.000Z', id: interviewRow.id }
  apiMocks.getInterviewHistory.mockImplementation((storeId: string, cursor?: typeof nextCursor) => {
    if (storeId === secondStoreId) return Promise.resolve({ rows: [], nextCursor: null })
    if (cursor) return Promise.resolve({ rows: [{ ...interviewRow, id: '77777777-7777-4777-8777-777777777777' }], nextCursor: null })
    return Promise.resolve({ rows: [interviewRow], nextCursor })
  })
  renderSwitchablePage('/interviews', <InterviewsPage />)

  await user.click(await screen.findByRole('button', { name: '次へ' }))
  await waitFor(() => expect(apiMocks.getInterviewHistory).toHaveBeenCalledWith(firstStoreId, nextCursor))

  await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))

  expect(await screen.findByRole('heading', { name: 'まだ回答はありません' })).toBeVisible()
  expect(apiMocks.getInterviewHistory).toHaveBeenCalledWith(secondStoreId, undefined)
  expect(apiMocks.getInterviewHistory).not.toHaveBeenCalledWith(secondStoreId, nextCursor)
})

test('JSONを直接ダウンロードし、外部ページは開かない', async () => {
  const user = userEvent.setup()
  apiMocks.getInterviewHistory.mockResolvedValue({ rows: [interviewRow], nextCursor: null })
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
  const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const objectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kuchitoru-analysis')
  const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  try {
    renderSwitchablePage('/interviews', <InterviewsPage />)

    await user.click(await screen.findByRole('button', { name: 'JSONをダウンロード' }))

    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1))
    expect(apiMocks.getAllInterviewRows).toHaveBeenCalledWith(firstStoreId)
    expect(apiMocks.getOwnerStore).toHaveBeenCalledWith(firstStoreId)
    expect(apiMocks.getSurveyRevisions).toHaveBeenCalledWith(firstStoreId)
    expect(openSpy).not.toHaveBeenCalled()
    expect(objectUrlSpy).toHaveBeenCalledTimes(1)
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:kuchitoru-analysis')
  } finally {
    revokeUrlSpy.mockRestore()
    objectUrlSpy.mockRestore()
    downloadSpy.mockRestore()
    openSpy.mockRestore()
  }
})

async function expectPendingExportToStopAfterStoreSwitch(buttonName: string) {
  const user = userEvent.setup()
  const pendingRows = deferred<InterviewRow[]>()
  apiMocks.getInterviewHistory.mockImplementation((storeId: string) => Promise.resolve(
    storeId === firstStoreId ? { rows: [interviewRow], nextCursor: null } : { rows: [], nextCursor: null },
  ))
  apiMocks.getAllInterviewRows.mockReturnValueOnce(pendingRows.promise)
  const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  try {
    renderSwitchablePage('/interviews', <InterviewsPage />)

    await user.click(await screen.findByRole('button', { name: buttonName }))
    expect(apiMocks.getAllInterviewRows).toHaveBeenCalledWith(firstStoreId)
    await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))
    expect(await screen.findByRole('heading', { name: 'まだ回答はありません' })).toBeVisible()

    await act(async () => pendingRows.resolve([interviewRow]))

    expect(downloadSpy).not.toHaveBeenCalled()
  } finally {
    downloadSpy.mockRestore()
  }
}

test('CSV作成中に店舗を切り替えると旧店舗のファイルをダウンロードしない', async () => {
  await expectPendingExportToStopAfterStoreSwitch('CSVをダウンロード')
})

test('JSON作成中に店舗を切り替えると旧店舗のファイルをダウンロードしない', async () => {
  await expectPendingExportToStopAfterStoreSwitch('JSONをダウンロード')
})

test('店舗を切り替えると旧店舗フォームを隠し、新店舗の取得完了後にだけ表示する', async () => {
  const user = userEvent.setup()
  const secondStore = deferred<StoreRecord | null>()
  apiMocks.getOwnerStore.mockImplementation((storeId: string) => (
    storeId === firstStoreId ? Promise.resolve(storeRecord(firstStoreId, '店舗A')) : secondStore.promise
  ))
  renderSwitchablePage('/store', <StorePage />)

  const nameInput = await screen.findByRole('textbox', { name: '店舗名' })
  await user.clear(nameInput)
  await user.type(nameInput, '店舗Aの未保存名')
  await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))

  expect(screen.getByText('店舗情報を読み込んでいます')).toBeVisible()
  expect(screen.queryByDisplayValue('店舗Aの未保存名')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存する' })).not.toBeInTheDocument()
  expect(apiMocks.saveOwnerStore).not.toHaveBeenCalled()

  await act(async () => secondStore.resolve(storeRecord(secondStoreId, '店舗B')))

  expect(await screen.findByRole('textbox', { name: '店舗名' })).toHaveValue('店舗B')
  expect(apiMocks.saveOwnerStore).not.toHaveBeenCalled()
})

test('店舗を切り替えると未保存APIキー・表示状態・保留中操作を新店舗へ持ち越さない', async () => {
  const user = userEvent.setup()
  const revalidation = deferred<AiConnection>()
  apiMocks.revalidateAiConnection.mockReturnValueOnce(revalidation.promise)
  renderSwitchablePage('/ai', <AiConnectionPage />)

  const firstModeButton = screen.queryByRole('button', { name: '自分のAPIキーを使う' })
  if (firstModeButton) await user.click(firstModeButton)

  const apiKeyInput = await screen.findByLabelText('OpenAI APIキー')
  await user.type(apiKeyInput, 'dummy-unsaved-value')
  await user.click(screen.getByRole('button', { name: 'OpenAIのAPIキーを表示' }))
  expect(apiKeyInput).toHaveAttribute('type', 'text')

  await user.click(screen.getByRole('button', { name: 'OpenAIを再確認' }))
  expect(screen.getByRole('button', { name: 'OpenAIを再確認' })).toHaveAttribute('aria-busy', 'true')

  await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))

  const switchedModeButton = screen.queryByRole('button', { name: '自分のAPIキーを使う' })
  if (switchedModeButton) await user.click(switchedModeButton)

  const switchedApiKeyInput = await screen.findByLabelText('OpenAI APIキー')
  expect(switchedApiKeyInput).toHaveValue('')
  expect(switchedApiKeyInput).toHaveAttribute('type', 'password')
  expect(screen.getByRole('button', { name: 'OpenAIを再確認' })).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByRole('button', { name: 'OpenAIを再確認' })).toBeEnabled()

  await act(async () => revalidation.resolve(activeConnection))
  expect(screen.queryByText('OpenAIを再確認しました。')).not.toBeInTheDocument()
  expect(apiMocks.revalidateAiConnection).toHaveBeenCalledTimes(1)
  expect(apiMocks.revalidateAiConnection).toHaveBeenCalledWith(firstStoreId, 'openai')
})
