import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { DEFAULT_SURVEY_CONFIG, type SurveyQuestion } from '../../shared/survey-config'
import { ApiError } from '../../shared/api/http'
import { loadInterviewSession, saveInterviewSession } from '../../shared/lib/interview-session-storage'

const testI18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))

const api = vi.hoisted(() => ({
  getPublicStore: vi.fn(),
  startInterviewSession: vi.fn(),
  saveInterviewTurn: vi.fn(),
  generateReview: vi.fn(),
  resumeInterviewSession: vi.fn(),
  rewriteReview: vi.fn(),
  saveReviewEdit: vi.fn(),
  recordReviewHandoff: vi.fn(),
}))

vi.mock('./public-interview-api', () => api)
vi.mock('../../shared/i18n', () => ({
  useI18n: () => {
    const localeTag = testI18n.locale === 'ja' ? 'ja-JP' : 'en-US'
    return {
      locale: testI18n.locale,
      localeTag,
      setLocale: (locale: 'ja' | 'en') => { testI18n.locale = locale },
      text: (copy: Readonly<Record<'ja' | 'en', string>>) => copy[testI18n.locale],
      formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(localeTag, options).format(value),
      formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(localeTag, options).format(value),
    }
  },
  parseLocale: (value: unknown) => value === 'ja' || value === 'en' ? value : null,
}))
vi.mock('../../shared/config/runtime', () => ({
  hasSupabaseConfiguration: false,
  runtimeConfig: { isE2ETestMode: true, turnstileSiteKey: '', supabaseUrl: '', supabasePublishableKey: '' },
}))
vi.mock('./useInterviewViewport', () => ({ useInterviewViewport: vi.fn() }))

import { PublicInterviewPage } from './PublicInterviewPage'

const store = {
  publicSlug: 'test-store-123456',
  name: '店舗',
  surveyConfig: DEFAULT_SURVEY_CONFIG,
  surveyRevision: 1,
  locale: 'ja' as const,
}
const session = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  sessionToken: 'a'.repeat(43),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  surveyConfig: DEFAULT_SURVEY_CONFIG,
  surveyRevision: 1,
  locale: 'ja' as const,
}

async function reachSurvey() {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/s/test-store-123456']}>
      <Routes>
        <Route path="/s/:publicSlug" element={<PublicInterviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await user.click(await screen.findByTestId('interview-start'))
  await screen.findByRole('heading', { name: DEFAULT_SURVEY_CONFIG.title })
  return user
}

async function completeRequiredQuestions(
  user: ReturnType<typeof userEvent.setup>,
  rating: 1 | 2 | 3 | 4 | 5 | null,
) {
  expect(screen.getByText('1 / 7')).toBeInTheDocument()
  expect(screen.queryByLabelText(/今回利用したメニュー・サービス/)).not.toBeInTheDocument()
  await user.click(screen.getByTestId('question-skip'))
  if (rating === null) await user.click(screen.getByTestId('question-skip'))
  else {
    await user.click(screen.getByTestId(`rating-${rating}`))
    await user.click(screen.getByTestId('question-next'))
  }
  await user.click(screen.getByTestId('question-skip'))
  await user.type(screen.getByLabelText(/今回利用したメニュー・サービス/), 'ランチ')
  await user.click(screen.getByTestId('question-next'))
  await user.type(screen.getByLabelText(/今回いちばん印象に残った場面/), '料理の説明を聞いた場面です。')
  await user.click(screen.getByTestId('question-next'))
  await user.click(screen.getByTestId('question-skip'))
  return screen.getByTestId('profile-submit')
}

function mockHappyPathApi() {
  testI18n.locale = 'ja'
  sessionStorage.clear()
  Object.values(api).forEach((mock) => mock.mockReset())
  api.getPublicStore.mockResolvedValue(store)
  api.startInterviewSession.mockResolvedValue(session)
  api.saveInterviewTurn.mockResolvedValue({
    answerSaved: true,
    turnCount: 0,
    maxTurns: 8,
    next: { kind: 'ready_for_review' },
  })
  api.generateReview.mockResolvedValue({
    review: '回答から作成した口コミ文です。',
    remainingRewrites: 2,
  })
}

describe('public survey required-only completion contract', () => {
  beforeEach(mockHappyPathApi)

  afterEach(cleanup)

  for (const rating of [1, 2, 3, 4, 5, null] as const) {
    it(`rating ${rating ?? '未回答'}でも必須設問だけで同じ確認画面へ進む`, async () => {
      const user = await reachSurvey()
      const submit = await completeRequiredQuestions(user, rating)
      expect(submit).toBeEnabled()
      await user.click(submit)

      await screen.findByTestId('review-editor')
      await waitFor(() => expect(api.saveInterviewTurn).toHaveBeenCalledOnce())
      const body = api.saveInterviewTurn.mock.calls[0]?.[0].body
      expect(body.surveyRevision).toBe(1)
      if (rating === null) {
        expect(body.answers.q_000000000002).toBeUndefined()
      } else {
        expect(body.answers.q_000000000002).toEqual({ type: 'rating_5', value: rating })
      }
    })
  }


  it('keeps optional details collapsed on the short welcome screen', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/s/test-store-123456']}>
        <Routes><Route path="/s/:publicSlug" element={<PublicInterviewPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: /ご来店の感想を.*お聞かせください/ })).toBeInTheDocument()
    expect(screen.getByText('7問・登録不要')).toBeInTheDocument()
    expect(screen.getByText('回答データの取り扱い')).toBeInTheDocument()
    expect(screen.getByText(/氏名・連絡先/)).not.toBeVisible()
    const toolbar = screen.getByText('店舗').closest('header')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.querySelector('svg')).toBeNull()
    const dataHandling = screen.getByText('回答データの取り扱い').closest('details')
    expect(dataHandling).not.toBeNull()
    await user.click(screen.getByText('回答データの取り扱い'))
    expect(dataHandling).toContainElement(screen.getByRole('link', { name: 'サポート' }))
    expect(dataHandling).toContainElement(screen.getByRole('link', { name: 'Source code' }))
    expect(dataHandling).toContainElement(screen.getByRole('link', { name: 'GNU AGPL v3 or later' }))
    expect(dataHandling).toContainElement(screen.getByRole('link', { name: '商標条件' }))
  })

  it.each([
    ['STORE_NOT_AVAILABLE', 404, 'このアンケートは現在利用できません。URLをご確認いただくか、店舗へお問い合わせください。'],
    ['TURNSTILE_REQUIRED', 400, 'セキュリティ確認を完了できませんでした。もう一度お試しください。'],
    ['TURNSTILE_FAILED', 403, 'セキュリティ確認を完了できませんでした。もう一度お試しください。'],
    ['RATE_LIMIT_EXCEEDED', 429, 'アクセスが集中しています。しばらく時間をおいてお試しください。'],
    ['NETWORK_ERROR', 0, '通信できませんでした。接続を確認して、もう一度お試しください。'],
  ])('shows start guidance for %s without appending unrelated security copy', async (code, status, expected) => {
    api.startInterviewSession.mockRejectedValueOnce(new ApiError({ code, status, message: 'server message' }))
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/s/test-store-123456']}>
        <Routes><Route path="/s/:publicSlug" element={<PublicInterviewPage />} /></Routes>
      </MemoryRouter>,
    )

    await user.click(await screen.findByTestId('interview-start'))

    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(/セキュリティ確認後に再試行できます/)).not.toBeInTheDocument()
  })

  it('resumes credentials without restoring browser-persisted answers', async () => {
    saveInterviewSession({
      publicSlug: store.publicSlug,
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      surveyConfig: session.surveyConfig,
      surveyRevision: session.surveyRevision,
      locale: 'ja',
    })
    api.resumeInterviewSession.mockResolvedValue({
      status: 'active', turnCount: 0, maxTurns: 8, interviewComplete: false,
      generationStatus: 'not_started', rewriteCount: 0, editedReview: null,
      remainingRewrites: 2, surveyConfig: DEFAULT_SURVEY_CONFIG, surveyRevision: 1,
      next: { kind: 'profile' },
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/s/test-store-123456']}>
        <Routes><Route path="/s/:publicSlug" element={<PublicInterviewPage />} /></Routes>
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: '前回のセッションを再開' }))
    expect(await screen.findByText('1 / 7')).toBeInTheDocument()
  })

  it('clears saved credentials when resume authentication fails', async () => {
    saveInterviewSession(sessionToStored())
    api.resumeInterviewSession.mockRejectedValue(new ApiError({ code: 'SESSION_INVALID', status: 401, message: 'invalid' }))
    const user = userEvent.setup()
    renderInterviewPage()

    await user.click(await screen.findByRole('button', { name: '前回のセッションを再開' }))
    expect(await screen.findByTestId('interview-start')).toBeInTheDocument()
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
  })

  it('clears saved credentials when the visitor cancels resume', async () => {
    saveInterviewSession(sessionToStored())
    const user = userEvent.setup()
    renderInterviewPage()

    await user.click(await screen.findByRole('button', { name: '新しく始める' }))
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
  })

  it('clears saved credentials when the store becomes unavailable', async () => {
    saveInterviewSession(sessionToStored())
    api.getPublicStore.mockRejectedValue(new Error('unavailable'))
    renderInterviewPage()

    expect(await screen.findByText('このインタビューは現在利用できません。')).toBeInTheDocument()
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
  })

  it('deletes an expired saved session while loading the page', async () => {
    sessionStorage.setItem(`kuchitoru:interview-session:${store.publicSlug}`, JSON.stringify({
      version: 1,
      ...sessionToStored(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
    }))
    renderInterviewPage()

    expect(await screen.findByTestId('interview-start')).toBeInTheDocument()
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
  })

  it('clears the previous store credentials when switching stores', async () => {
    saveInterviewSession(sessionToStored())
    api.getPublicStore.mockImplementation((slug: string) => Promise.resolve({ ...store, publicSlug: slug }))
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/s/test-store-123456']}>
        <StoreSwitcher />
        <Routes><Route path="/s/:publicSlug" element={<PublicInterviewPage />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: '前回のセッションを再開' })

    await user.click(screen.getByRole('button', { name: '店舗を切り替える' }))
    await waitFor(() => expect(api.getPublicStore).toHaveBeenCalledWith('other-store-123456'))
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
  })

  it('shows one generic generation error and uses a fresh operation key for every retry', async () => {
    api.generateReview.mockRejectedValue(new Error('AI_PROVIDER_RATE_LIMITED must stay internal'))
    const user = await reachSurvey()
    const submit = await completeRequiredQuestions(user, 5)

    await user.click(submit)
    expect(await screen.findByText('エラーが発生しました。')).toBeInTheDocument()
    expect(screen.queryByText(/AI_PROVIDER_RATE_LIMITED/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'やり直す' }))
    await waitFor(() => expect(api.generateReview).toHaveBeenCalledTimes(2))

    const firstKey = api.generateReview.mock.calls[0]?.[0].idempotencyKey
    const secondKey = api.generateReview.mock.calls[1]?.[0].idempotencyKey
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBeTruthy()
    expect(secondKey).not.toBe(firstKey)
  })

  it('keeps the current review and allows repeated rewrite attempts with fresh keys', async () => {
    api.rewriteReview.mockRejectedValue(new Error('AI_PROVIDER_TIMEOUT must stay internal'))
    const user = await reachSurvey()
    const submit = await completeRequiredQuestions(user, 4)
    await user.click(submit)
    const editor = await screen.findByTestId('review-editor')
    expect(editor).toHaveValue('回答から作成した口コミ文です。')

    await user.click(screen.getByRole('button', { name: /もう一度作る/ }))
    expect(await screen.findByText('エラーが発生しました。')).toBeInTheDocument()
    expect(editor).toHaveValue('回答から作成した口コミ文です。')
    expect(screen.queryByText(/AI_PROVIDER_TIMEOUT/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /やり直す/ }))
    await waitFor(() => expect(api.rewriteReview).toHaveBeenCalledTimes(2))

    const firstKey = api.rewriteReview.mock.calls[0]?.[0].idempotencyKey
    const secondKey = api.rewriteReview.mock.calls[1]?.[0].idempotencyKey
    expect(secondKey).not.toBe(firstKey)
  })
})

function sessionToStored() {
  return {
    publicSlug: store.publicSlug,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    surveyConfig: session.surveyConfig,
    surveyRevision: session.surveyRevision,
    locale: 'ja' as const,
  }
}

function renderInterviewPage() {
  return render(
    <MemoryRouter initialEntries={['/s/test-store-123456']}>
      <Routes><Route path="/s/:publicSlug" element={<PublicInterviewPage />} /></Routes>
    </MemoryRouter>,
  )
}

function StoreSwitcher() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/s/other-store-123456')}>店舗を切り替える</button>
}

const GOOGLE_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=e2e-place'

describe('Google handoff confirmation dialog', () => {
  let popup: { close: ReturnType<typeof vi.fn>; location: { replace: ReturnType<typeof vi.fn> }; opener: unknown }
  let openWindow: ReturnType<typeof vi.fn>
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockHappyPathApi()
    api.recordReviewHandoff.mockResolvedValue({ recorded: true, googleReviewUrl: GOOGLE_REVIEW_URL })
    popup = { close: vi.fn(), location: { replace: vi.fn() }, opener: {} }
    openWindow = vi.fn(() => popup)
    vi.stubGlobal('open', openWindow)
    writeText = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  async function reachReviewEditor() {
    const user = await reachSurvey()
    // userEvent.setup() installs its own clipboard stub, so ours has to land afterwards.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const submit = await completeRequiredQuestions(user, 5)
    await user.click(submit)
    await screen.findByTestId('review-editor')
    return user
  }

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('google-handoff'))
    return screen.findByRole('dialog', { name: 'Googleへの投稿はあと少しです' })
  }

  it('opens the guidance dialog without opening Google, recording the event, or clearing the session', async () => {
    const user = await reachReviewEditor()
    const dialog = await openDialog(user)

    expect(dialog).toHaveAccessibleDescription(/自動では投稿されません/)
    const steps = within(dialog).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0]).toHaveTextContent('Googleにログイン')
    expect(steps[1]).toHaveTextContent('口コミ欄に貼り付け')
    expect(steps[2]).toHaveTextContent('内容を確認して投稿')
    expect(openWindow).not.toHaveBeenCalled()
    expect(api.recordReviewHandoff).not.toHaveBeenCalled()
    expect(popup.location.replace).not.toHaveBeenCalled()
    expect(loadInterviewSession(store.publicSlug)).not.toBeNull()
  })

  it('moves initial focus into the dialog and restores it to the trigger on Escape', async () => {
    const user = await reachReviewEditor()
    const trigger = screen.getByTestId('google-handoff')
    const dialog = await openDialog(user)

    await waitFor(() => expect(within(dialog).getByTestId('google-handoff-copy')).toHaveFocus())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('keeps the edited review and the session when the visitor cancels', async () => {
    const user = await reachReviewEditor()
    const editor = screen.getByTestId('review-editor')
    await user.clear(editor)
    await user.type(editor, '編集した口コミ文です。')

    await openDialog(user)
    await user.click(screen.getByTestId('google-handoff-cancel'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('review-editor')).toHaveValue('編集した口コミ文です。')
    expect(loadInterviewSession(store.publicSlug)).not.toBeNull()

    await openDialog(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('review-editor')).toHaveValue('編集した口コミ文です。')
    expect(api.recordReviewHandoff).not.toHaveBeenCalled()
  })

  it('copies the currently edited review from inside the dialog and confirms it', async () => {
    const user = await reachReviewEditor()
    const editor = screen.getByTestId('review-editor')
    await user.clear(editor)
    await user.type(editor, '編集した口コミ文です。')

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByTestId('google-handoff-copy'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('編集した口コミ文です。'))
    expect(await within(dialog).findByText('コピーしました。')).toBeInTheDocument()
    expect(api.recordReviewHandoff).toHaveBeenCalledTimes(1)
    expect(api.recordReviewHandoff.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'review_text_copied',
      editedReview: '編集した口コミ文です。',
    })
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('keeps the Google button usable when copying fails', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = await reachReviewEditor()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByTestId('google-handoff-copy'))
    expect(await within(dialog).findByText(/コピーできませんでした/)).toBeInTheDocument()

    const confirm = within(dialog).getByTestId('google-handoff-confirm')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(GOOGLE_REVIEW_URL))
  })

  it('records google_review_opened and opens the review URL only after the primary button', async () => {
    const user = await reachReviewEditor()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByTestId('google-handoff-confirm'))

    await waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(GOOGLE_REVIEW_URL))
    expect(openWindow).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank')
    expect(popup.opener).toBeNull()
    expect(api.recordReviewHandoff).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: 'google_review_opened' }),
    )
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
    expect(await screen.findByRole('heading', { name: 'ありがとうございました' })).toBeInTheDocument()
  })

  it('clears saved credentials when finishing without posting', async () => {
    const user = await reachReviewEditor()

    await user.click(screen.getByRole('button', { name: '投稿せず終了' }))

    expect(await screen.findByRole('heading', { name: 'ありがとうございました' })).toBeInTheDocument()
    expect(loadInterviewSession(store.publicSlug)).toBeNull()
  })

  it('never duplicates the handoff event or the blank tab when the primary button is tapped twice', async () => {
    let settle: (result: { recorded: boolean; googleReviewUrl: string }) => void = () => {}
    api.recordReviewHandoff.mockImplementation(
      () => new Promise((resolve) => { settle = resolve }),
    )
    const user = await reachReviewEditor()
    const dialog = await openDialog(user)
    const confirm = within(dialog).getByTestId('google-handoff-confirm')

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    fireEvent.click(confirm)

    settle({ recorded: true, googleReviewUrl: GOOGLE_REVIEW_URL })
    await waitFor(() => expect(popup.location.replace).toHaveBeenCalledTimes(1))
    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(api.recordReviewHandoff).toHaveBeenCalledTimes(1)
  })

  it('closes the blank tab, closes the dialog and stays retryable when the handoff API fails', async () => {
    api.recordReviewHandoff.mockRejectedValueOnce(new Error('Google口コミ画面を開けませんでした。'))
    const user = await reachReviewEditor()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByTestId('google-handoff-confirm'))

    await waitFor(() => expect(popup.close).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(popup.location.replace).not.toHaveBeenCalled()
    expect(screen.getByText('Google口コミ画面を開けませんでした。')).toBeInTheDocument()
    expect(screen.getByTestId('review-editor')).toHaveValue('回答から作成した口コミ文です。')
    expect(loadInterviewSession(store.publicSlug)).not.toBeNull()

    const retried = await openDialog(user)
    await user.click(within(retried).getByTestId('google-handoff-confirm'))
    await waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(GOOGLE_REVIEW_URL))
    expect(api.recordReviewHandoff).toHaveBeenCalledTimes(2)
  })
})


describe('English public journey', () => {
  beforeEach(() => {
    mockHappyPathApi()
    testI18n.locale = 'en'
  })
  afterEach(cleanup)

  it('localizes first-visit chrome, freezes English, and preserves Japanese survey source', async () => {
    api.startInterviewSession.mockResolvedValueOnce({ ...session, locale: 'en' })
    const user = userEvent.setup()
    renderInterviewPage()
    expect(await screen.findByRole('heading', { name: 'Tell us about your visit' })).toBeVisible()
    await user.click(screen.getByTestId('interview-start'))
    expect(api.startInterviewSession).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }))
    expect(screen.getByRole('heading', { name: DEFAULT_SURVEY_CONFIG.title })).toBeVisible()
    expect(screen.getByText('The survey content below was written by the store in Japanese and is shown unchanged.')).toBeVisible()
    expect(loadInterviewSession(store.publicSlug)).toMatchObject({ locale: 'en', surveyConfig: DEFAULT_SURVEY_CONFIG })
  })
})


describe('locale freeze and source-language corrections', () => {
  beforeEach(mockHappyPathApi)
  afterEach(cleanup)

  it('does not refetch or reset survey state when the global locale changes', async () => {
    const user = userEvent.setup()
    const view = renderInterviewPage()
    await user.click(await screen.findByTestId('interview-start'))
    await user.click(screen.getByLabelText('初めて'))
    await user.click(screen.getByTestId('question-next'))
    expect(screen.getByText('2 / 7')).toBeVisible()

    testI18n.locale = 'en'
    view.rerender(
      <MemoryRouter initialEntries={['/s/test-store-123456']}>
        <Routes><Route path="/s/:publicSlug" element={<PublicInterviewPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('2 / 7')).toBeVisible()
    expect(api.getPublicStore).toHaveBeenCalledTimes(1)
    expect(loadInterviewSession(store.publicSlug)?.locale).toBe('ja')
    await user.click(screen.getByRole('button', { name: '戻る' }))
    expect(screen.getByLabelText('初めて')).toBeChecked()
  })

  it('does not show the Japanese-source note for an English-authored snapshot', async () => {
    testI18n.locale = 'en'
    const englishConfig = {
      ...DEFAULT_SURVEY_CONFIG,
      title: 'Tell us about your visit',
      description: 'A short survey about your experience.',
      questions: DEFAULT_SURVEY_CONFIG.questions.map(toEnglishQuestion),
    }
    api.getPublicStore.mockResolvedValueOnce({ ...store, surveyConfig: englishConfig })
    api.startInterviewSession.mockResolvedValueOnce({ ...session, locale: 'en', surveyConfig: englishConfig })
    const user = userEvent.setup()
    renderInterviewPage()
    await user.click(await screen.findByTestId('interview-start'))
    expect(screen.getByRole('heading', { name: englishConfig.title })).toBeVisible()
    expect(screen.queryByText('The survey content below was written by the store in Japanese and is shown unchanged.')).not.toBeInTheDocument()
  })

  it('uses an English fallback instead of an unknown upstream Japanese start error', async () => {
    testI18n.locale = 'en'
    api.startInterviewSession.mockRejectedValueOnce(new ApiError({ code: 'UNKNOWN_FAILURE', status: 500, message: '日本語の内部エラー' }))
    const user = userEvent.setup()
    renderInterviewPage()
    await user.click(await screen.findByTestId('interview-start'))
    expect(await screen.findByText('Could not start the interview.')).toBeVisible()
    expect(screen.queryByText('日本語の内部エラー')).not.toBeInTheDocument()
  })
})

function toEnglishQuestion(question: SurveyQuestion): SurveyQuestion {
  const result = structuredClone(question)
  result.label = 'English question'
  if (result.help !== undefined) result.help = 'English help'
  if (result.type === 'short_text' || result.type === 'long_text') {
    if (result.placeholder !== undefined) result.placeholder = 'English placeholder'
  } else if (result.type === 'single_choice' || result.type === 'multi_choice') {
    result.options = result.options.map((option, index) => ({ ...option, label: `Option ${index + 1}` }))
  } else {
    result.lowLabel = 'Low'
    result.highLabel = 'High'
  }
  return result
}

describe('English review action error localization', () => {
  let popup: { close: ReturnType<typeof vi.fn>; location: { replace: ReturnType<typeof vi.fn> }; opener: unknown }
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockHappyPathApi()
    testI18n.locale = 'en'
    api.startInterviewSession.mockResolvedValue({ ...session, locale: 'en' })
    api.recordReviewHandoff.mockResolvedValue({ recorded: true, googleReviewUrl: GOOGLE_REVIEW_URL })
    popup = { close: vi.fn(), location: { replace: vi.fn() }, opener: {} }
    vi.stubGlobal('open', vi.fn(() => popup))
    writeText = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  async function reachEnglishReviewEditor() {
    const user = await reachSurvey()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const submit = await completeRequiredQuestions(user, 5)
    await user.click(submit)
    await screen.findByTestId('review-editor')
    return user
  }

  it('uses the English save fallback for a Japanese upstream API message', async () => {
    api.saveReviewEdit.mockRejectedValueOnce(new ApiError({ code: 'UNKNOWN_FAILURE', status: 500, message: '編集内容を保存できませんでした。' }))
    const user = await reachEnglishReviewEditor()
    await user.click(screen.getByTestId('review-save'))
    expect(await screen.findByText('Could not save.')).toBeVisible()
    expect(screen.queryByText('編集内容を保存できませんでした。')).not.toBeInTheDocument()
  })

  it('uses the English copy fallback when recording the copy handoff returns Japanese', async () => {
    api.recordReviewHandoff.mockRejectedValueOnce(new ApiError({ code: 'UNKNOWN_FAILURE', status: 500, message: 'コピー記録に失敗しました。' }))
    const user = await reachEnglishReviewEditor()
    await user.click(screen.getByTestId('review-copy'))
    expect(await screen.findByText('Could not copy. The text has been selected; use your device’s copy command.')).toBeVisible()
    expect(screen.queryByText('コピー記録に失敗しました。')).not.toBeInTheDocument()
    expect(screen.getByTestId('review-editor')).toHaveFocus()
  })

  it('uses the English Google fallback for a Japanese upstream handoff message', async () => {
    api.recordReviewHandoff.mockRejectedValueOnce(new ApiError({ code: 'UNKNOWN_FAILURE', status: 500, message: 'Google口コミ画面を開けませんでした。' }))
    const user = await reachEnglishReviewEditor()
    await user.click(screen.getByTestId('google-handoff'))
    const dialog = await screen.findByRole('dialog', { name: 'You’re almost ready to post on Google' })
    await user.click(within(dialog).getByTestId('google-handoff-confirm'))
    await waitFor(() => expect(popup.close).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Could not open the Google review page.')).toBeVisible()
    expect(screen.queryByText('Google口コミ画面を開けませんでした。')).not.toBeInTheDocument()
  })
})
