import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { AI_PROVIDER_CATALOG } from '../../shared/ai-providers'
import { I18nProvider } from '../../shared/i18n'
import type * as OwnerApiModule from './owner-api'
import { AiConnectionPage, InterviewsPage, SummaryPage } from './OwnerPages'

const storeId = '44444444-4444-4444-8444-444444444444'

const apiMocks = vi.hoisted(() => ({
  getAiConnection: vi.fn(),
  getAiConnections: vi.fn(),
  deleteAiConnection: vi.fn(),
  revalidateAiConnection: vi.fn(),
  selectAiProvider: vi.fn(),
  selectAiModel: vi.fn(),
  validateAndSaveAiConnection: vi.fn(),
  getInterviewHistory: vi.fn(),
  getMonthlySummary: vi.fn(),
}))

vi.mock('./owner-api', async () => {
  const actual = await vi.importActual<typeof OwnerApiModule>('./owner-api')
  return { ...actual, ...apiMocks }
})

const EMPTY_SUMMARY = {
  period_start: '2026-08-01',
  period_end: '2026-09-01',
  started: 0,
  completed: 0,
  completion_rate: 0,
  generation_succeeded: 0,
  google_handoffs: 0,
  average_rating: null,
  previous_started: 0,
  started_change: 0,
  rating_distribution: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.getInterviewHistory.mockResolvedValue({ rows: [], nextCursor: null })
  apiMocks.getMonthlySummary.mockResolvedValue(EMPTY_SUMMARY)
  apiMocks.getAiConnection.mockResolvedValue(null)
  apiMocks.getAiConnections.mockResolvedValue([])
  apiMocks.deleteAiConnection.mockResolvedValue(undefined)
  apiMocks.revalidateAiConnection.mockResolvedValue(undefined)
  apiMocks.selectAiProvider.mockResolvedValue(undefined)
  apiMocks.selectAiModel.mockResolvedValue(undefined)
  apiMocks.validateAndSaveAiConnection.mockResolvedValue(undefined)
})

function renderPage(path: string, element: React.ReactNode, locale: 'ja' | 'en' = 'ja') {
  window.localStorage.setItem('kuchitoru.locale', locale)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider><MemoryRouter initialEntries={[`/dashboard/stores/${storeId}${path}`]}>
        <Routes>
          <Route path={`/dashboard/stores/:storeId${path}`} element={element} />
        </Routes>
      </MemoryRouter></I18nProvider>
    </QueryClientProvider>,
  )
}

async function showOwnApiSettings() {
  const button = screen.queryByRole('button', { name: '自分のAPIキーを使う' })
  if (button) await userEvent.click(button)
}

test('回答が0件なら、取得エラーではなく回答を集める導線を表示する', async () => {
  renderPage('/interviews', <InterviewsPage />)

  expect(await screen.findByRole('heading', { name: 'まだ回答はありません' })).toBeVisible()
  expect(screen.getByRole('link', { name: '回答を集める準備をする' })).toHaveAttribute('href', `/dashboard/stores/${storeId}/qr`)
  expect(screen.queryByText('回答履歴を取得できませんでした')).not.toBeInTheDocument()
  expect(screen.getByTestId('analysis-download')).toBeDisabled()
  expect(screen.getByTestId('csv-download')).toBeDisabled()
})

test('回答履歴の取得失敗なら、0件表示にせず再試行できる', async () => {
  const user = userEvent.setup()
  apiMocks.getInterviewHistory
    .mockRejectedValueOnce(new Error('network error'))
    .mockResolvedValueOnce({ rows: [], nextCursor: null })
  renderPage('/interviews', <InterviewsPage />)

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('回答履歴を取得できませんでした')
  expect(alert).toHaveTextContent('回答が0件という意味ではありません。')
  expect(screen.queryByRole('heading', { name: 'まだ回答はありません' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'もう一度試す' }))
  expect(await screen.findByRole('heading', { name: 'まだ回答はありません' })).toBeVisible()
  expect(apiMocks.getInterviewHistory).toHaveBeenCalledTimes(2)
})

test('今月の回答が0件なら、月次サマリーの空状態を表示する', async () => {
  renderPage('/summary', <SummaryPage />)

  expect(await screen.findByRole('heading', { name: '今月の回答はまだありません' })).toBeVisible()
  expect(screen.getByRole('link', { name: '回答を集める準備をする' })).toHaveAttribute('href', `/dashboard/stores/${storeId}/qr`)
  expect(screen.queryByText('AIを使わず、保存された回答から集計します。')).not.toBeInTheDocument()
  expect(screen.queryByText('月次サマリーを取得できませんでした')).not.toBeInTheDocument()
})

test('月次サマリーの取得失敗なら、0件表示にせず再試行を表示する', async () => {
  apiMocks.getMonthlySummary.mockRejectedValueOnce(new Error('network error'))
  renderPage('/summary', <SummaryPage />)

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('月次サマリーを取得できませんでした')
  expect(alert).toHaveTextContent('集計データを読み込めませんでした。')
  expect(screen.getByRole('button', { name: 'もう一度試す' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: '今月の回答はまだありません' })).not.toBeInTheDocument()
})

test('英語の回答履歴は日本語の口コミを保ったまま操作案内を英語で表示する', async () => {
  apiMocks.getInterviewHistory.mockResolvedValue({ rows: [{ id:'response-1', created_at:'2026-08-19T01:00:00Z', status:'completed', rating:5, visit_frequency:'初めて', generated_review:'とても美味しかったです', edited_review:null, generation_status:'succeeded', generation_provider:'openai', google_handoff_opened_at:null, answers:{} }], nextCursor: null })
  renderPage('/interviews', <InterviewsPage />, 'en')

  expect(await screen.findByText('とても美味しかったです')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Response history' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Generation status' })).toBeVisible()
  expect(screen.queryByText('回答履歴')).not.toBeInTheDocument()
  expect(screen.queryByText('生成済み')).not.toBeInTheDocument()
})

test('英語の回答履歴と月次サマリーの空状態は英語の導線を表示する', async () => {
  const interviews = renderPage('/interviews', <InterviewsPage />, 'en')
  expect(await screen.findByRole('heading', { name: 'No responses yet' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Get ready to collect responses' })).toBeVisible()
  expect(screen.queryByText('まだ回答はありません')).not.toBeInTheDocument()
  interviews.unmount()

  renderPage('/summary', <SummaryPage />, 'en')
  expect(await screen.findByRole('heading', { name: 'No responses this month yet' })).toBeVisible()
  expect(screen.queryByText('今月の回答はまだありません')).not.toBeInTheDocument()
})

test('AI接続が0件なら、未接続の案内と接続フォームを表示する', async () => {
  renderPage('/ai', <AiConnectionPage />)
  await showOwnApiSettings()

  expect(await screen.findByRole('heading', { name: 'AI接続はまだありません' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'AIを接続する' })).toHaveAttribute('href', '#ai-provider-settings')
  expect(screen.queryByRole('region', { name: 'AI接続の概要' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'AIを選択' })).toBeVisible()
  expect(screen.queryByText('保存済みのキーは表示されません。')).not.toBeInTheDocument()
  expect(screen.queryByText('AI接続を取得できませんでした')).not.toBeInTheDocument()
})

test('APIキー入力時だけ補足を表示する', async () => {
  const user = userEvent.setup()
  renderPage('/ai', <AiConnectionPage />)
  await showOwnApiSettings()

  const apiKey = await screen.findByLabelText('OpenAI APIキー')
  expect(screen.queryByText('保存済みのキーは表示されません。')).not.toBeInTheDocument()
  await user.type(apiKey, 'sk-example-123456')
  expect(screen.getByText('保存済みのキーは表示されません。')).toBeVisible()
})

test('接続状態をカード右側の使用中・接続済み・未接続に集約する', async () => {
  apiMocks.getAiConnection.mockResolvedValue({ provider: 'openai', model: 'gpt-5-mini', status: 'active', keyLast4: 'tKQA' })
  apiMocks.getAiConnections.mockResolvedValue([
    { provider: 'openai', model: 'gpt-5-mini', status: 'active', keyLast4: 'tKQA' },
    { provider: 'gemini', model: 'gemini-3.6-flash', status: 'active', keyLast4: '1234' },
  ])
  renderPage('/ai', <AiConnectionPage />)
  await showOwnApiSettings()

  expect(await screen.findByRole('button', { name: 'OpenAIは使用中' })).toHaveTextContent('使用中')
  const geminiItem = screen.getByRole('button', { name: 'Geminiの設定を開く' })
  expect(geminiItem).toHaveTextContent('接続済み')
  const deepSeekItem = screen.getByRole('button', { name: 'DeepSeekの設定を開く' })
  expect(deepSeekItem).toHaveTextContent('未接続')
  await userEvent.click(geminiItem)
  const selectGemini = screen.getByRole('button', { name: 'Geminiを使用する' })
  expect(selectGemini).toHaveTextContent('接続済み')
  await userEvent.click(selectGemini)
  expect(apiMocks.selectAiProvider).toHaveBeenCalledWith(storeId, 'gemini')
  await userEvent.click(deepSeekItem)
  expect(screen.getByRole('button', { name: 'DeepSeekは未接続' })).toHaveTextContent('未接続')
  expect(screen.queryByText(/末尾 tKQA/)).not.toBeInTheDocument()
})

test('AI接続の取得失敗なら、未接続と誤表示せず設定操作を隠す', async () => {
  const user = userEvent.setup()
  apiMocks.getAiConnections
    .mockRejectedValueOnce(new Error('network error'))
    .mockResolvedValueOnce([])
  renderPage('/ai', <AiConnectionPage />)
  await showOwnApiSettings()

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('AI接続を取得できませんでした')
  expect(alert).toHaveTextContent('未接続という意味ではない')
  expect(screen.queryByRole('heading', { name: 'AI接続はまだありません' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'AI接続の概要' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'AIを選択' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'もう一度試す' }))
  expect(await screen.findByRole('heading', { name: 'AI接続はまだありません' })).toBeVisible()
  expect(apiMocks.getAiConnections).toHaveBeenCalledTimes(2)
})

test('英語で空・失敗状態とAPIキーの表示、検証、保存を案内する', async () => {
  const user = userEvent.setup()
  renderPage('/ai', <AiConnectionPage />, 'en')

  expect(await screen.findByRole('heading', { name: 'No AI connections yet' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Choose an AI provider' })).toBeVisible()
  const apiKey = screen.getByLabelText('OpenAI API key')
  await user.type(apiKey, 'short')
  await user.click(screen.getByRole('button', { name: 'Show OpenAI API key' }))
  expect(apiKey).toHaveAttribute('type', 'text')
  expect(screen.getByText('Saved keys are never displayed.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Validate and save API key' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the API key you entered.')

  await user.clear(apiKey)
  await user.type(apiKey, 'sk-example-123456')
  await user.click(screen.getByRole('button', { name: 'Validate and save API key' }))
  expect(await screen.findByText('Saved the OpenAI API key and made it active.')).toBeVisible()
  expect(apiMocks.validateAndSaveAiConnection).toHaveBeenCalledWith(storeId, expect.objectContaining({ provider: 'openai', model: AI_PROVIDER_CATALOG.openai.defaultModel, activate: true }))
})

test('英語のAPIキー保存失敗は上流の日本語エラーを表示しない', async () => {
  const user = userEvent.setup()
  apiMocks.validateAndSaveAiConnection.mockRejectedValueOnce(new Error('APIキーを保存できませんでした。詳細'))
  renderPage('/ai', <AiConnectionPage />, 'en')

  const apiKey = await screen.findByLabelText('OpenAI API key')
  await user.type(apiKey, 'sk-example-123456')
  await user.click(screen.getByRole('button', { name: 'Validate and save API key' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the API key.')
  expect(screen.getByRole('alert')).not.toHaveTextContent('詳細')
})

test('英語で接続状態、モデル保存、再検証、削除確認を表示する', async () => {
  const user = userEvent.setup()
  apiMocks.getAiConnection.mockResolvedValue({ provider: 'openai', model: 'gpt-5-mini', status: 'active', keyLast4: '1234' })
  apiMocks.getAiConnections.mockResolvedValue([
    { provider: 'openai', model: 'gpt-5-mini', status: 'active', keyLast4: '1234' },
    { provider: 'gemini', model: 'gemini-3.6-flash', status: 'active', keyLast4: '5678' },
  ])
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    renderPage('/ai', <AiConnectionPage />, 'en')
    expect(await screen.findByRole('button', { name: 'OpenAI is Active' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open Gemini settings' })).toHaveTextContent('Connected')
    expect(screen.getByRole('button', { name: 'Open DeepSeek settings' })).toHaveTextContent('Disconnected')

    await user.click(screen.getByRole('button', { name: 'Open Gemini settings' }))
    await user.selectOptions(screen.getByLabelText('Gemini model'), 'gemini-2.5-flash')
    await user.click(screen.getByRole('button', { name: 'Save Gemini model' }))
    expect(apiMocks.selectAiModel).toHaveBeenCalledWith(storeId, 'gemini', 'gemini-2.5-flash')
    await user.click(screen.getByRole('button', { name: 'Revalidate Gemini' }))
    expect(apiMocks.revalidateAiConnection).toHaveBeenCalledWith(storeId, 'gemini')
    await user.click(screen.getByRole('button', { name: 'Open OpenAI settings' }))
    await user.click(screen.getByRole('button', { name: 'Delete OpenAI connection' }))
    expect(confirm).toHaveBeenCalledWith('OpenAI is currently active. Deleting it will disable AI draft generation. Delete the API key?')
    expect(apiMocks.deleteAiConnection).toHaveBeenCalledWith(storeId, 'openai')
  } finally {
    confirm.mockRestore()
  }
})

test('英語の取得失敗は未接続と誤表示しない', async () => {
  apiMocks.getAiConnections.mockRejectedValue(new Error('network error'))
  renderPage('/ai', <AiConnectionPage />, 'en')
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load AI connections')
  expect(screen.getByRole('alert')).toHaveTextContent('This does not mean you are disconnected.')
  expect(screen.queryByRole('heading', { name: 'No AI connections yet' })).not.toBeInTheDocument()
})
