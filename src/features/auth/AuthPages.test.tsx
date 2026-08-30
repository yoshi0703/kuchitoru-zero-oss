import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'

const authMocks = vi.hoisted(() => ({
  resendSignupConfirmation: vi.fn(),
  requestPasswordReset: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  updatePassword: vi.fn(),
  state: { status: 'anonymous', passwordRecoveryReady: false },
}))

vi.mock('../../shared/config/runtime', () => ({
  runtimeConfig: { googleAuthEnabled: false, isE2ETestMode: true, turnstileSiteKey: '' },
}))

vi.mock('./auth-context', () => ({
  useAuth: () => ({
    status: authMocks.state.status,
    passwordRecoveryReady: authMocks.state.passwordRecoveryReady,
    signIn: authMocks.signIn,
    signUp: authMocks.signUp,
    updatePassword: authMocks.updatePassword,
    signInWithGoogle: vi.fn(),
    resendSignupConfirmation: authMocks.resendSignupConfirmation,
    requestPasswordReset: authMocks.requestPasswordReset,
  }),
}))

import { ForgotPasswordPage, LoginPage, RegisterPage, UpdatePasswordPage } from './AuthPages'

const renderPage = (page: React.ReactNode) => render(<I18nProvider>{page}</I18nProvider>)

beforeEach(() => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  document.documentElement.lang = 'ja'
  authMocks.signIn.mockRejectedValue(new Error('メールアドレスまたはパスワードを確認してください。'))
  authMocks.resendSignupConfirmation.mockResolvedValue(undefined)
  authMocks.requestPasswordReset.mockResolvedValue(undefined)
  authMocks.signUp.mockResolvedValue(undefined)
  authMocks.updatePassword.mockResolvedValue(undefined)
  authMocks.state.status = 'anonymous'
  authMocks.state.passwordRecoveryReady = false
})

test('device-selected English exposes English authentication controls', () => {
  localStorage.setItem('kuchitoru.locale', 'en')
  renderPage(<MemoryRouter><LoginPage /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  expect(screen.getByLabelText('Email address')).toBeVisible()
  expect(screen.getByLabelText('Password')).toBeVisible()
})

test('English authentication states contain no Japanese product chrome', async () => {
  localStorage.setItem('kuchitoru.locale', 'en')
  const assertPanel = (container: HTMLElement) => expect(container.querySelector('.auth-panel')?.textContent).not.toMatch(/[ぁ-んァ-ン一-龯]/)

  const login = renderPage(<MemoryRouter><LoginPage /></MemoryRouter>)
  assertPanel(login.container)
  login.unmount()

  const register = renderPage(<MemoryRouter><RegisterPage /></MemoryRouter>)
  assertPanel(register.container)
  register.unmount()

  const forgot = renderPage(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
  assertPanel(forgot.container)
  forgot.unmount()

  authMocks.state.status = 'authenticated'
  authMocks.state.passwordRecoveryReady = true
  const update = renderPage(<MemoryRouter><UpdatePasswordPage /></MemoryRouter>)
  assertPanel(update.container)
})

test('アカウント作成は有効な入力を認証APIへ送る', async () => {
  const user = userEvent.setup()
  renderPage(<MemoryRouter><RegisterPage /></MemoryRouter>)

  await user.type(screen.getByLabelText('メールアドレス'), 'new@example.test')
  await user.type(screen.getByLabelText('パスワード', { exact: true }), 'Password-123!')
  await user.click(screen.getByRole('button', { name: 'アカウントを作成' }))

  expect(authMocks.signUp).toHaveBeenCalledWith('new@example.test', 'Password-123!', 'e2e-turnstile-token')
  expect(await screen.findByText(/確認メールを送信しました/)).toBeVisible()
})

test('アカウント作成でパスワード条件を説明し、条件未達なら送信しない', async () => {
  const user = userEvent.setup()
  renderPage(<MemoryRouter><RegisterPage /></MemoryRouter>)

  expect(screen.getByText('8文字以上で、英大文字・英小文字・数字・記号をそれぞれ1文字以上含めてください。')).toBeVisible()
  await user.type(screen.getByLabelText('メールアドレス'), 'new@example.test')
  await user.type(screen.getByLabelText('パスワード', { exact: true }), 'password123')
  await user.click(screen.getByRole('button', { name: 'アカウントを作成' }))

  expect(await screen.findByText('パスワードの条件を満たしていません。')).toBeVisible()
  expect(authMocks.signUp).not.toHaveBeenCalled()
})

test('パスワード再設定でも同じ条件を説明し、満たした値だけ更新する', async () => {
  const user = userEvent.setup()
  authMocks.state.status = 'authenticated'
  authMocks.state.passwordRecoveryReady = true
  renderPage(<MemoryRouter><UpdatePasswordPage /></MemoryRouter>)

  expect(screen.getByText('8文字以上で、英大文字・英小文字・数字・記号をそれぞれ1文字以上含めてください。')).toBeVisible()
  const input = screen.getByLabelText('パスワード', { exact: true })
  await user.type(input, 'password123')
  await user.click(screen.getByRole('button', { name: 'パスワードを更新' }))
  expect(authMocks.updatePassword).not.toHaveBeenCalled()

  await user.clear(input)
  await user.type(input, 'Password-123!')
  await user.click(screen.getByRole('button', { name: 'パスワードを更新' }))
  expect(authMocks.updatePassword).toHaveBeenCalledWith('Password-123!')
})

test('アカウント状態を明かさずに確認メールを再送できる', async () => {
  const user = userEvent.setup()
  renderPage(<MemoryRouter><LoginPage /></MemoryRouter>)

  await user.type(screen.getByLabelText('メールアドレス'), 'owner@example.test')
  await user.type(screen.getByLabelText('パスワード', { exact: true }), 'password-123')
  await user.click(screen.getByRole('button', { name: 'ログイン' }))

  expect(await screen.findByText(/メールアドレスまたはパスワードを確認してください/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '確認メールを再送' }))

  expect(authMocks.resendSignupConfirmation).toHaveBeenCalledWith('owner@example.test', 'e2e-turnstile-token')
  expect(await screen.findByText(/登録済みで未確認の場合/)).toBeVisible()
})

test('再送APIが拒否してもアカウント状態を明かさない', async () => {
  const user = userEvent.setup()
  authMocks.resendSignupConfirmation.mockRejectedValue(new Error('rate limited'))
  renderPage(<MemoryRouter><LoginPage /></MemoryRouter>)

  await user.type(screen.getByLabelText('メールアドレス'), 'owner@example.test')
  await user.click(screen.getByRole('button', { name: '確認メールを再送' }))

  expect(await screen.findByText(/登録済みで未確認の場合/)).toBeVisible()
  expect(screen.queryByText(/rate limited/)).not.toBeInTheDocument()
})

test('確認メールの再送中は二重送信を防ぐ', async () => {
  const user = userEvent.setup()
  authMocks.resendSignupConfirmation.mockReturnValue(new Promise(() => undefined))
  renderPage(<MemoryRouter><LoginPage /></MemoryRouter>)

  await user.type(screen.getByLabelText('メールアドレス'), 'owner@example.test')
  const resendButton = screen.getByRole('button', { name: '確認メールを再送' })
  await user.dblClick(resendButton)

  expect(authMocks.resendSignupConfirmation).toHaveBeenCalledTimes(1)
  expect(resendButton).toBeDisabled()
})

test('パスワード再設定へTurnstile tokenを渡す', async () => {
  const user = userEvent.setup()
  renderPage(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

  await user.type(screen.getByLabelText('メールアドレス'), 'owner@example.test')
  await user.click(screen.getByRole('button', { name: '再設定メールを送る' }))

  expect(authMocks.requestPasswordReset).toHaveBeenCalledWith('owner@example.test', 'e2e-turnstile-token')
  expect(await screen.findByText(/メールを送信しました/)).toBeVisible()
})
