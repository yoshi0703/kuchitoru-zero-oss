import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock('../../shared/config/runtime', () => ({
  runtimeConfig: {
    appOrigin: 'https://app.kuchitoru.example',
    googleAuthEnabled: false,
    isE2ETestMode: false,
  },
}))

vi.mock('../../shared/api/supabase', () => ({
  supabase: {
    auth: {
      ...authMocks,
      onAuthStateChange: authMocks.onAuthStateChange,
    },
  },
}))

import { AuthProvider, useAuth } from './auth-context'
import { I18nProvider } from '../../shared/i18n'

const renderAuth = (node: React.ReactNode) => render(<I18nProvider><AuthProvider>{node}</AuthProvider></I18nProvider>)

function AuthProbe() {
  const { user, requestPasswordReset, resendSignupConfirmation, signIn, signUp, updateAccountEmail, updateAccountPassword } = useAuth()
  return (
    <>
      <span>{user?.email}</span>
      <button type="button" onClick={() => void signIn('owner@example.test', 'password-123', 'captcha-login').catch(() => undefined)}>ログイン</button>
      <button type="button" onClick={() => void resendSignupConfirmation('owner@example.test', 'captcha-resend')}>確認メールを再送</button>
      <button type="button" onClick={() => void signUp('new@example.test', 'password-123', 'captcha-signup')}>登録</button>
      <button type="button" onClick={() => void requestPasswordReset('owner@example.test', 'captcha-recovery')}>再設定メール</button>
      <button type="button" onClick={() => void updateAccountEmail('changed@example.test')}>メールアドレス変更</button>
      <button type="button" onClick={() => void updateAccountPassword('Current-123!', 'Changed-123!', 'captcha-change-password')}>パスワード変更</button>
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  authMocks.getSession.mockResolvedValue({ data: { session: null } })
  authMocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  authMocks.resend.mockResolvedValue({ error: null })
  authMocks.resetPasswordForEmail.mockResolvedValue({ error: null })
  authMocks.signInWithPassword.mockResolvedValue({ error: null })
  authMocks.signUp.mockResolvedValue({ error: null })
  authMocks.updateUser.mockResolvedValue({ error: null })
})

test('account metadata language becomes active and language updates persist first', async () => {
  authMocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner-id', email: 'owner@example.test', user_metadata: { language: 'en' } } } } })
  function LanguageProbe() {
    const { user, updateAccountLanguage } = useAuth()
    return <><span>{user?.language}</span><button onClick={() => void updateAccountLanguage('ja')}>日本語</button></>
  }
  renderAuth(<LanguageProbe />)
  expect(await screen.findByText('en')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '日本語' }))
  await waitFor(() => expect(authMocks.updateUser).toHaveBeenCalledWith({ data: { language: 'ja' } }))
  expect(document.documentElement.lang).toBe('ja')
})

test('登録時に言語をアカウントへ保存する', async () => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  renderAuth(<AuthProbe />)
  await userEvent.click(screen.getByRole('button', { name: '登録' }))

  await waitFor(() => expect(authMocks.signUp).toHaveBeenCalledWith({
    email: 'new@example.test',
    password: 'password-123',
    options: {
      captchaToken: 'captcha-signup',
      emailRedirectTo: 'https://app.kuchitoru.example/auth/callback?returnTo=%2Fdashboard',
      data: { language: 'ja' },
    },
  }))
})

test('ログイン時にTurnstile tokenを渡す', async () => {
  renderAuth(<AuthProbe />)
  await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))

  await waitFor(() => expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
    email: 'owner@example.test',
    password: 'password-123',
    options: { captchaToken: 'captcha-login' },
  }))
})

test('確認メールを本番の認証callback付きで再送する', async () => {
  renderAuth(<AuthProbe />)
  await userEvent.click(screen.getByRole('button', { name: '確認メールを再送' }))

  await waitFor(() => expect(authMocks.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'owner@example.test',
    options: {
      captchaToken: 'captcha-resend',
      emailRedirectTo: 'https://app.kuchitoru.example/auth/callback?returnTo=%2Fdashboard',
    },
  }))
})

test('パスワード再設定時にTurnstile tokenを渡す', async () => {
  renderAuth(<AuthProbe />)
  await userEvent.click(screen.getByRole('button', { name: '再設定メール' }))

  await waitFor(() => expect(authMocks.resetPasswordForEmail).toHaveBeenCalledWith(
    'owner@example.test',
    {
      captchaToken: 'captcha-recovery',
      redirectTo: 'https://app.kuchitoru.example/auth/update-password',
    },
  ))
})

test('メールアドレス変更の確認後にアカウント画面へ戻す', async () => {
  renderAuth(<AuthProbe />)
  await userEvent.click(screen.getByRole('button', { name: 'メールアドレス変更' }))

  await waitFor(() => expect(authMocks.updateUser).toHaveBeenCalledWith(
    { email: 'changed@example.test' },
    { emailRedirectTo: 'https://app.kuchitoru.example/auth/callback?returnTo=%2Faccount' },
  ))
})

test('現在のパスワードで再認証してからパスワードを変更する', async () => {
  authMocks.getSession.mockResolvedValue({
    data: { session: { user: { id: 'owner-id', email: 'owner@example.test' } } },
  })
  renderAuth(<AuthProbe />)
  await screen.findByText('owner@example.test')
  await userEvent.click(screen.getByRole('button', { name: 'パスワード変更' }))

  await waitFor(() => expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
    email: 'owner@example.test',
    password: 'Current-123!',
    options: { captchaToken: 'captcha-change-password' },
  }))
  expect(authMocks.updateUser).toHaveBeenCalledWith({ password: 'Changed-123!' })
})

test.each(['email_not_confirmed', 'invalid_credentials'])('ログイン失敗理由をアカウント状態によらず同じ文言にする: %s', async (code) => {
  authMocks.signInWithPassword.mockResolvedValue({ error: { code } })

  let message = ''
  function ErrorProbe() {
    const { signIn } = useAuth()
    return <button type="button" onClick={() => void signIn('owner@example.test', 'password-123', 'captcha-login').catch((error: unknown) => { message = error instanceof Error ? error.message : '' })}>ログイン</button>
  }

  renderAuth(<ErrorProbe />)
  await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))

  await waitFor(() => expect(message).toBe('Please check your email address and password.'))
})
