import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '../../shared/api/http'
import { I18nProvider } from '../../shared/i18n'
import {
  DEFAULT_SURVEY_CONFIG,
  SURVEY_PRESETS,
  upcastV3ToV4,
  type SurveyConfigV3,
  type SurveyDefinitionV4,
  type SurveyQuestionGroup,
} from '../../shared/survey-config'
import { SurveySettingsPage } from './SurveySettingsPage'

const storeId = '44444444-4444-4444-8444-444444444444'
const secondStoreId = '55555555-5555-4555-8555-555555555555'

const apiMocks = vi.hoisted(() => ({
  getSurveyConfig: vi.fn(),
  getSurveyPresets: vi.fn(),
  saveSurveyConfig: vi.fn(),
}))
const ownerApiMocks = vi.hoisted(() => ({
  getOwnerStore: vi.fn(),
}))

vi.mock('./survey-config-api', () => apiMocks)
vi.mock('./owner-api', () => ownerApiMocks)

const STORE = {
  id: 'store-id',
  name: '幸寿司',
  industry: '江戸前寿司店',
  address: '東京都武蔵野市',
  description: '1984年創業の寿司店です。',
  website_url: 'https://example.com/',
  welcome_message: 'ご利用ありがとうございます。',
  closing_message: 'ご回答ありがとうございました。',
  status: 'draft',
}

beforeEach(() => {
  window.localStorage.setItem('kuchitoru.locale', 'ja')
  vi.clearAllMocks()
  ownerApiMocks.getOwnerStore.mockResolvedValue(STORE)
  apiMocks.getSurveyConfig.mockResolvedValue(structuredClone(DEFAULT_SURVEY_CONFIG))
  apiMocks.getSurveyPresets.mockResolvedValue(structuredClone([...SURVEY_PRESETS]))
  apiMocks.saveSurveyConfig.mockImplementation((_storeId: string, config: SurveyDefinitionV4) => Promise.resolve(config))
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/survey`]}>
        <Routes>
          <Route path="/dashboard/stores/:storeId/survey" element={<SurveySettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function SwitchStoreButton() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(`/dashboard/stores/${secondStoreId}/survey`)}>
      店舗を切り替える
    </button>
  )
}

function renderSwitchablePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rendered = render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/dashboard/stores/${storeId}/survey`]}>
        <Routes>
          <Route
            path="/dashboard/stores/:storeId/survey"
            element={<><SwitchStoreButton /><SurveySettingsPage /></>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
  return { ...rendered, queryClient }
}

async function firstQuestionCard() {
  const firstQuestion = DEFAULT_SURVEY_CONFIG.questions[0]
  if (!firstQuestion) throw new Error('default question missing')
  const title = await screen.findByText(`1. ${firstQuestion.label}`)
  const card = title.closest('section')
  if (!card) throw new Error('question card missing')
  return card
}

test('店舗未登録なら店舗情報入力への導線を表示する', async () => {
  ownerApiMocks.getOwnerStore.mockResolvedValueOnce(null)
  apiMocks.getSurveyConfig.mockRejectedValueOnce(new ApiError({
    code: 'STORE_NOT_FOUND',
    message: '店舗が見つかりません。',
    status: 404,
  }))
  renderPage()

  expect(await screen.findByRole('heading', { name: '先に店舗情報を登録してください' })).toBeVisible()
  expect(screen.getByRole('link', { name: '店舗情報を登録する' })).toHaveAttribute('href', `/dashboard/stores/${storeId}/store`)
})

test('英語UIでも保存済みのソース文言を変更しない', async () => {
  window.localStorage.setItem('kuchitoru.locale', 'en')
  const saved = structuredClone(DEFAULT_SURVEY_CONFIG)
  saved.title = '保存済み・Source title'
  if (saved.questions[0]) saved.questions[0].label = '既存質問 / Existing source'
  apiMocks.getSurveyConfig.mockResolvedValue(saved)

  renderPage()

  expect(await screen.findByRole('heading', { name: 'Edit survey' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add question' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /Survey heading/ })).toHaveValue('保存済み・Source title')
  expect(screen.getByText('1. 既存質問 / Existing source')).toBeInTheDocument()
})

test('英語UIでは既知のサーバープリセットを英語スターターとして適用する', async () => {
  window.localStorage.setItem('kuchitoru.locale', 'en')
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('button', { name: 'Add question' })

  await user.click(screen.getByRole('button', { name: 'Start over from a preset' }))
  expect(screen.getByRole('option', { name: 'Quick: 3 questions' })).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Preset'), 'quick_3')
  expect(screen.getByText('A short format that minimizes the effort required to respond')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Use this preset' }))
  await user.click(screen.getByRole('button', { name: 'Replace' }))

  expect(screen.getByRole('textbox', { name: /Survey heading/ })).toHaveValue('Tell us about your visit')
  expect(screen.getByText('1. What menu item or service did you use?')).toBeVisible()
})

test('英語UIでは検証と不明な保存失敗を英語だけで表示する', async () => {
  window.localStorage.setItem('kuchitoru.locale', 'en')
  const user = userEvent.setup()
  apiMocks.saveSurveyConfig.mockRejectedValue(new Error('アンケートを保存できませんでした。'))
  renderPage()

  await user.click(await screen.findByRole('button', { name: /1\. 今回のご利用は何回目ですか/ }))
  const question = screen.getByLabelText(/Question text/)
  await user.clear(question)
  await user.type(question, 'Enter your email address')
  expect(await screen.findByText('Check questions 1.')).toBeVisible()
  expect(screen.getByText('Questions must not request personal, sensitive, authentication, or instructional content.')).toBeVisible()

  await user.clear(question)
  await user.type(question, 'A safe question')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Could not save the survey. Please try again.')).toBeVisible()
  expect(screen.queryByText('アンケートを保存できませんでした。')).not.toBeInTheDocument()
})

test('質問を追加して展開し、文言と形式を編集できる', async () => {
  const user = userEvent.setup()
  renderPage()

  expect(await screen.findAllByText(/^[1-7]\. /)).toHaveLength(7)
  expect(screen.queryByLabelText('質問文')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '質問を追加' }))
  await user.click(screen.getByRole('menuitem', { name: /短い文章/ }))

  const label = await screen.findByLabelText(/質問文/)
  expect(label).toHaveFocus()
  await user.clear(label)
  await user.type(label, '帰り際に感じたことを教えてください')
  await user.selectOptions(screen.getByLabelText('回答の形式'), 'long_text')

  expect(screen.getByText('未保存の変更があります。')).toBeVisible()
  expect(screen.getByText('8. 帰り際に感じたことを教えてください')).toBeVisible()
  expect(screen.getAllByText('長い文章').length).toBeGreaterThan(0)
})

test('アンケートをiPhone 17風のスマートフォン枠内にプレビューする', async () => {
  renderPage()

  const device = await screen.findByRole('region', { name: 'iPhone 17風のスマートフォン画面' })
  expect(device).toBeVisible()
  expect(within(device).getByRole('heading', { name: DEFAULT_SURVEY_CONFIG.title })).toBeVisible()
})

test('上部の重複操作を表示せず、下部の保存操作だけを残す', async () => {
  renderPage()

  await screen.findByRole('button', { name: '質問を追加' })
  expect(screen.queryByRole('button', { name: 'プレビュー' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '保存する' })).toHaveLength(1)
})

test('上下移動後に移動先カードへフォーカスし、位置を読み上げる', async () => {
  const user = userEvent.setup()
  renderPage()
  const card = await firstQuestionCard()

  await user.click(within(card).getByRole('button', { name: '下へ移動' }))

  expect(await screen.findByText('2番目に移動しました')).toBeInTheDocument()
  const firstQuestion = DEFAULT_SURVEY_CONFIG.questions[0]
  if (!firstQuestion) throw new Error('default question missing')
  expect(screen.getByText(`2. ${firstQuestion.label}`).closest('[tabindex="-1"]')).toHaveFocus()
})

test('現在のパターンを複製し、タブと矢印で切り替えて削除できる', async () => {
  const user = userEvent.setup()
  renderPage()
  const thirdQuestion = DEFAULT_SURVEY_CONFIG.questions[2]
  if (!thirdQuestion) throw new Error('default question missing')
  const title = await screen.findByText(`3. ${thirdQuestion.label}`)
  const card = title.closest('section')
  if (!card) throw new Error('question card missing')

  await user.click(within(card).getByRole('button', { name: '質問パターンを追加' }))
  expect(within(card).getByText('2パターン')).toBeVisible()
  expect(within(card).getByRole('tab', { name: 'パターンB' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByLabelText(/質問文/)).toHaveFocus()

  await user.click(within(card).getByRole('button', { name: '前の質問パターン' }))
  expect(within(card).getByRole('tab', { name: 'パターンA' })).toHaveAttribute('aria-selected', 'true')
  await user.click(within(card).getByRole('tab', { name: 'パターンB' }))
  await user.click(within(card).getByRole('button', { name: '現在の質問パターンを削除' }))
  expect(within(card).getByText('1パターン')).toBeVisible()
  expect(within(card).queryByRole('tab', { name: 'パターンB' })).not.toBeInTheDocument()
})

test('展開中カードのヘッダーを横スワイプしてパターンを切り替えられる', async () => {
  const user = userEvent.setup()
  renderPage()
  const thirdQuestion = DEFAULT_SURVEY_CONFIG.questions[2]
  if (!thirdQuestion) throw new Error('default question missing')
  const card = (await screen.findByText(`3. ${thirdQuestion.label}`)).closest('section')
  if (!card) throw new Error('question card missing')

  await user.click(within(card).getByRole('button', { name: '質問パターンを追加' }))
  await user.click(within(card).getByRole('button', { name: '前の質問パターン' }))
  const header = card.querySelector('.survey-question-card__summary')
  if (!header) throw new Error('question header missing')
  fireEvent.touchStart(header, { touches: [{ clientX: 240, clientY: 80 }] })
  fireEvent.touchEnd(header, { changedTouches: [{ clientX: 120, clientY: 84 }] })

  expect(within(card).getByRole('tab', { name: 'パターンB' })).toHaveAttribute('aria-selected', 'true')
})

test('プレビューは編集だけでは再抽選せず、明示操作で別パターンへ切り替わる', async () => {
  const definition = upcastV3ToV4(structuredClone(DEFAULT_SURVEY_CONFIG))
  const group = definition.questionGroups[2]
  const first = group?.variants[0]
  if (!group || !first) throw new Error('fixture group missing')
  first.label = 'パターンAの質問'
  ;(group.variants as Array<SurveyQuestionGroup['variants'][number]>).push({
    ...structuredClone(first), id: 'q_bbbbbbbbbbbb', label: 'パターンBの質問',
  })
  apiMocks.getSurveyConfig.mockResolvedValueOnce(definition)
  const user = userEvent.setup()
  renderPage()

  const device = await screen.findByRole('region', { name: 'iPhone 17風のスマートフォン画面' })
  expect(within(device).getByText('パターンAの質問')).toBeVisible()
  expect(screen.getByText('Q3：A')).toBeVisible()

  const thirdCard = screen.getByText('3. パターンAの質問').closest('section')
  if (!thirdCard) throw new Error('third card missing')
  await user.click(within(thirdCard).getByRole('button', { name: /3\. パターンAの質問/ }))
  await user.clear(screen.getByLabelText(/質問文/))
  await user.type(screen.getByLabelText(/質問文/), '編集中のパターンA')
  expect(within(device).getByText('編集中のパターンA')).toBeVisible()
  expect(screen.getByText('Q3：A')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '別パターンで表示' }))
  expect(within(device).getByText('パターンBの質問')).toBeVisible()
  expect(screen.getByText('Q3：B')).toBeVisible()

  fireEvent.touchStart(device, { touches: [{ clientX: 100, clientY: 300 }] })
  fireEvent.touchEnd(device, { changedTouches: [{ clientX: 220, clientY: 304 }] })
  expect(within(device).getByText('編集中のパターンA')).toBeVisible()
  expect(screen.getByText('Q3：A')).toBeVisible()
})

test('12問に達すると追加を止め、理由を表示する', async () => {
  const config = structuredClone(DEFAULT_SURVEY_CONFIG)
  const source = config.questions[2]
  if (!source) throw new Error('default question missing')
  config.questions = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(source),
    id: `q_${(index + 1).toString(16).padStart(12, '0')}`,
    label: `質問${index + 1}`,
  }))
  apiMocks.getSurveyConfig.mockResolvedValueOnce(config)
  renderPage()

  const add = await screen.findByRole('button', { name: '質問を追加' })
  expect(add).toBeDisabled()
  expect(screen.getByText('質問は12問までです。')).toBeVisible()
})

test('roleは型と既存設定に応じて排他的に制御される', async () => {
  const user = userEvent.setup()
  const config = structuredClone(DEFAULT_SURVEY_CONFIG)
  config.questions.push({
    id: 'q_aaaaaaaaaaaa',
    type: 'rating_5',
    label: 'もうひとつの評価',
    required: false,
    lowLabel: '低い',
    highLabel: '高い',
  })
  apiMocks.getSurveyConfig.mockResolvedValueOnce(config)
  renderPage()

  const eighthCard = (await screen.findByRole('button', { name: /8\. もうひとつの評価/ })).closest('section')
  if (!eighthCard) throw new Error('eighth question card missing')
  await user.click(within(eighthCard).getByRole('button', { name: /8\. もうひとつの評価/ }))
  await user.click(within(eighthCard).getByText('詳細設定'))
  const secondRatingSwitch = screen.getByRole('switch', { name: '8番目の質問を評価として使う' })
  expect(secondRatingSwitch).toBeDisabled()
  expect(screen.getByText(/すでに「今回の体験を5段階でいうと」で使用しています/)).toBeVisible()

  const secondCard = screen.getByRole('button', { name: /2\. 今回の体験を5段階でいうと/ }).closest('section')
  if (!secondCard) throw new Error('second question card missing')
  await user.click(within(secondCard).getByRole('button', { name: /2\. 今回の体験を5段階でいうと/ }))
  await user.click(within(secondCard).getByText('詳細設定'))
  await user.click(within(secondCard).getByRole('switch', { name: '2番目の質問を評価として使う' }))
  await user.click(within(eighthCard).getByRole('button', { name: /8\. もうひとつの評価/ }))
  await user.click(within(eighthCard).getByText('詳細設定'))
  expect(screen.getByRole('switch', { name: '8番目の質問を評価として使う' })).toBeEnabled()
})

test('詳細設定は初期状態で閉じ、必須設定の冗長な説明を表示しない', async () => {
  const user = userEvent.setup()
  renderPage()
  const card = await firstQuestionCard()
  await user.click(within(card).getByRole('button', { name: /1\. 今回のご利用は何回目ですか/ }))

  expect(within(card).getByText('詳細設定')).toBeVisible()
  expect(within(card).getByRole('switch', { name: '1番目の質問を評価として使う', hidden: true })).not.toBeVisible()
  expect(within(card).queryByText('どのパターンが選ばれても共通で必須になります。')).not.toBeInTheDocument()

  await user.click(within(card).getByText('詳細設定'))
  expect(within(card).getByRole('switch', { name: '1番目の質問を評価として使う' })).toBeVisible()
  expect(within(card).getByText('来店頻度として集計中')).toBeVisible()
})

test('禁止された設問文は該当欄とページ先頭の両方で示す', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: /1\. 今回のご利用は何回目ですか/ }))
  const input = screen.getByLabelText(/質問文/)
  await user.clear(input)
  await user.type(input, '電話番号を入力してください')

  expect(await screen.findByText('1番目の質問を確認してください。')).toBeVisible()
  expect(screen.getByText('個人情報、機微情報、認証情報、または命令を含む設問は設定できません。')).toBeVisible()
})

test('公開中の変更では警告と未保存状態を表示する', async () => {
  const user = userEvent.setup()
  ownerApiMocks.getOwnerStore.mockResolvedValueOnce({ ...STORE, status: 'published' })
  renderPage()

  const title = await screen.findByRole('textbox', { name: /アンケートの見出し/ })
  await user.type(title, ' 更新')

  expect(screen.getByText('未保存の変更があります。')).toBeVisible()
  expect(screen.getByText(/公開中のアンケートを変更します/)).toBeVisible()
})

test('プリセットは確認後にだけ現在の質問を置き換える', async () => {
  const user = userEvent.setup()
  renderPage()
  expect(await screen.findAllByText(/^[1-7]\. /)).toHaveLength(7)

  await user.click(screen.getByRole('button', { name: 'プリセットから作り直す' }))
  await user.selectOptions(screen.getByLabelText('プリセット'), 'quick_3')
  await user.click(screen.getByRole('button', { name: 'このプリセットを使う' }))
  expect(screen.getByText(/現在の質問を、選んだプリセットの質問へ置き換えます/)).toBeVisible()
  expect(screen.getAllByText(/^[1-7]\. /)).toHaveLength(7)

  await user.click(screen.getByRole('button', { name: '置き換える' }))
  expect(screen.getAllByText(/^[1-3]\. /)).toHaveLength(3)
  expect(screen.getByText(/プリセットを編集欄へ反映しました/)).toBeVisible()
}, 10_000)

test('明示的に保存すると成功通知を出して未保存状態を解消する', async () => {
  const user = userEvent.setup()
  renderPage()
  const title = await screen.findByRole('textbox', { name: /アンケートの見出し/ })
  await user.type(title, ' 更新')
  const save = screen.getAllByRole('button', { name: '保存する' })[0]
  if (!save) throw new Error('save button missing')
  await user.click(save)

  await waitFor(() => expect(apiMocks.saveSurveyConfig).toHaveBeenCalledTimes(1))
  expect(apiMocks.saveSurveyConfig).toHaveBeenCalledWith(storeId, expect.objectContaining({
    version: 4,
    questionGroups: expect.any(Array),
  }))
  expect(await screen.findByText('アンケート設定を保存しました。公開ページにも反映されます。')).toBeVisible()
  expect(screen.getByText('すべて保存されています。')).toBeVisible()
})

test('保存中に店舗を切り替えても旧店舗の結果を新店舗フォームとキャッシュへ混ぜない', async () => {
  const user = userEvent.setup()
  const firstConfig = { ...structuredClone(DEFAULT_SURVEY_CONFIG), title: '店舗Aのアンケート' }
  const secondConfig = { ...structuredClone(DEFAULT_SURVEY_CONFIG), title: '店舗Bのアンケート' }
  const savedFirstConfig = { ...firstConfig, title: '店舗Aの保存結果' }
  const pendingSave = deferred<SurveyDefinitionV4>()
  ownerApiMocks.getOwnerStore.mockImplementation((activeStoreId: string) => Promise.resolve({
    ...STORE,
    id: activeStoreId,
    name: activeStoreId === storeId ? '店舗A' : '店舗B',
  }))
  apiMocks.getSurveyConfig.mockImplementation((activeStoreId: string) => Promise.resolve(
    activeStoreId === storeId ? structuredClone(firstConfig) : structuredClone(secondConfig),
  ))
  apiMocks.saveSurveyConfig.mockReturnValueOnce(pendingSave.promise)
  const { queryClient } = renderSwitchablePage()

  const firstTitle = await screen.findByRole('textbox', { name: /アンケートの見出し/ })
  expect(firstTitle).toHaveValue('店舗Aのアンケート')
  await user.clear(firstTitle)
  await user.type(firstTitle, '店舗Aの編集中アンケート')
  const save = screen.getAllByRole('button', { name: '保存する' })[0]
  if (!save) throw new Error('save button missing')
  await user.click(save)
  await waitFor(() => expect(apiMocks.saveSurveyConfig).toHaveBeenCalledWith(
    storeId,
    expect.objectContaining({ title: '店舗Aの編集中アンケート' }),
  ))

  await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))
  expect(await screen.findByRole('textbox', { name: /アンケートの見出し/ })).toHaveValue('店舗Bのアンケート')

  const savedFirstDefinition = upcastV3ToV4(savedFirstConfig)
  await act(async () => pendingSave.resolve(savedFirstDefinition))

  await waitFor(() => expect(queryClient.getQueryData<SurveyDefinitionV4>(['survey-config', storeId])).toEqual(savedFirstDefinition))
  expect(screen.getByRole('textbox', { name: /アンケートの見出し/ })).toHaveValue('店舗Bのアンケート')
  expect(queryClient.getQueryData<SurveyConfigV3>(['survey-config', secondStoreId])).toEqual(secondConfig)
  expect(screen.queryByText('アンケート設定を保存しました。公開ページにも反映されます。')).not.toBeInTheDocument()
})
