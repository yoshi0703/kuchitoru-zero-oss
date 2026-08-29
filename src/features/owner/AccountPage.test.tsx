import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { ThemeProvider } from '../../shared/theme/ThemeProvider'
import { THEME_STORAGE_KEY } from '../../shared/theme/theme'
import { AccountPage } from './OwnerPages'
import { I18nProvider } from '../../shared/i18n'

const { signIn, signOut, updateAccountEmail, updateAccountPassword, updateAccountLanguage } = vi.hoisted(() => ({
  signIn: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  updateAccountEmail: vi.fn().mockResolvedValue(undefined),
  updateAccountPassword: vi.fn().mockResolvedValue(undefined),
  updateAccountLanguage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../shared/config/runtime', () => ({
  hasSupabaseConfiguration: false,
  runtimeConfig: {
    googleAuthEnabled: false,
    isE2ETestMode: true,
    supabasePublishableKey: '',
    supabaseUrl: '',
    turnstileSiteKey: '',
  },
}))

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'owner-id', email: 'owner@example.test' },
    signOut,
    signIn,
    signInWithGoogle: vi.fn(),
    updateAccountEmail,
    updateAccountPassword,
    updateAccountLanguage,
  }),
}))

beforeEach(() => {
  signOut.mockResolvedValue(undefined)
  signIn.mockResolvedValue(undefined)
  updateAccountEmail.mockResolvedValue(undefined)
  updateAccountPassword.mockResolvedValue(undefined)
  updateAccountLanguage.mockResolvedValue(undefined)
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeMode
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

function renderAccount(locale: 'ja' | 'en' = 'ja') {
  window.localStorage.setItem('kuchitoru.locale', locale)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider><ThemeProvider>
        <MemoryRouter initialEntries={['/account']}>
          <AccountPage />
        </MemoryRouter>
      </ThemeProvider></I18nProvider>
    </QueryClientProvider>,
  )
}

test('英語でアカウント設定、言語、検証、ログアウト、削除再認証を表示する', async () => {
  const user = userEvent.setup()
  renderAccount('en')

  expect(screen.getByRole('heading', { name: 'Account' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Language' })).toBeVisible()
  expect(screen.getByRole('group', { name: 'Choose language' })).toContainElement(screen.getByRole('button', { name: 'English' }))
  await user.click(screen.getByText('Login information'))
  await user.type(screen.getByLabelText('New email address'), 'owner@example.test')
  await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
  expect(await screen.findByText('Enter an email address different from your current one.')).toBeVisible()

  await user.type(screen.getByLabelText('Current password'), 'Current-123!')
  await user.type(screen.getByLabelText('New password'), 'weak')
  await user.type(screen.getByLabelText('Confirm new password'), 'weak')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await screen.findByText('The new password does not meet the requirements.')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Log out' }))
  expect(signOut).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: 'Start account deletion' }))
  expect(screen.getByText('Deletion cannot be undone.')).toBeVisible()
  await user.type(screen.getByLabelText('Password'), 'Password-123!')
  await user.click(screen.getByRole('button', { name: 'Reauthenticate with password' }))
  expect(signIn).toHaveBeenCalledWith('owner@example.test', 'Password-123!', 'e2e-turnstile-token')
  expect(await screen.findByRole('button', { name: 'Delete account now' })).toBeVisible()
})

test('アカウント画面に重複した管理画面への戻る導線を表示しない', () => {
  renderAccount()

  expect(screen.getByRole('heading', { name: 'アカウント' })).toBeVisible()
  expect(screen.queryByRole('link', { name: '管理画面に戻る' })).not.toBeInTheDocument()
})

test('ログイン情報は初期状態で閉じ、必要な時だけ展開する', async () => {
  const user = userEvent.setup()
  renderAccount()

  const disclosure = screen.getByText('ログイン情報').closest('details')
  expect(disclosure).not.toHaveAttribute('open')
  expect(screen.getByLabelText('新しいメールアドレス')).not.toBeVisible()

  await user.click(screen.getByText('ログイン情報'))

  expect(disclosure).toHaveAttribute('open')
  expect(screen.getByLabelText('新しいメールアドレス')).toBeVisible()
})

test('アカウント画面からログアウトできる', async () => {
  const user = userEvent.setup()
  renderAccount()

  expect(screen.getByRole('heading', { name: 'ログアウト' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'ログアウト' }))
  expect(signOut).toHaveBeenCalledOnce()
})

test('アカウント操作を見出しと同じ行にまとめ、不要な説明文を表示しない', () => {
  renderAccount()

  const logoutPanel = screen.getByRole('heading', { name: 'ログアウト' }).closest('.account-action-panel')
  const deletePanel = screen.getByRole('heading', { name: 'アカウントを削除' }).closest('.account-action-panel')

  expect(logoutPanel).toContainElement(screen.getByRole('button', { name: 'ログアウト' }))
  expect(deletePanel).toContainElement(screen.getByRole('button', { name: '削除手続きを始める' }))
  expect(screen.queryByText('機能が一時停止中でも止められます。')).not.toBeInTheDocument()
  expect(screen.queryByText(/店舗、回答、AI接続を削除します/)).not.toBeInTheDocument()
})

test('表示テーマは初期状態で端末設定に従い、アカウント画面から変更できる', async () => {
  const user = userEvent.setup()
  renderAccount()

  expect(screen.getByRole('heading', { name: '表示設定' })).toBeVisible()
  expect(screen.getByRole('button', { name: '端末の設定テーマ' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(screen.getByRole('button', { name: 'ダークテーマ' }))

  expect(screen.getByRole('button', { name: 'ダークテーマ' })).toHaveAttribute('aria-pressed', 'true')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
})

test('言語設定を切り替え、処理中の重複操作とエラーを扱う', async () => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  let reject!: (error: Error) => void
  updateAccountLanguage.mockImplementationOnce(() => new Promise<void>((_, nextReject) => { reject = nextReject }))
  const user = userEvent.setup()
  renderAccount()
  await user.click(screen.getByRole('button', { name: 'English' }))
  expect(updateAccountLanguage).toHaveBeenCalledWith('en')
  expect(screen.getByRole('button', { name: '日本語' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'English' }))
  expect(updateAccountLanguage).toHaveBeenCalledOnce()
  reject(new Error('保存できませんでした。'))
  expect(await screen.findByText('保存できませんでした。')).toBeVisible()
})

test('英語表示では日本語の言語更新エラーを安全な英語へ置き換える', async () => {
  updateAccountLanguage.mockRejectedValueOnce(new Error('保存できませんでした。'))
  const user = userEvent.setup()
  renderAccount('en')

  await user.click(screen.getByRole('button', { name: '日本語' }))

  expect(await screen.findByText('Could not update the language setting.')).toBeVisible()
  expect(screen.queryByText('保存できませんでした。')).not.toBeInTheDocument()
})

test('アカウント画面からメールアドレス変更の確認メールを送信できる', async () => {
  const user = userEvent.setup()
  renderAccount()

  await user.click(screen.getByText('ログイン情報'))
  expect(screen.getByText('現在のメールアドレス：owner@example.test')).toBeVisible()
  await user.type(screen.getByLabelText('新しいメールアドレス'), 'changed@example.test')
  await user.click(screen.getByRole('button', { name: '確認メールを送信' }))

  expect(updateAccountEmail).toHaveBeenCalledWith('changed@example.test')
  expect(await screen.findByText('確認メールを送信しました。メール内の案内に沿って変更を完了してください。')).toBeVisible()
})

test('アカウント画面から現在のパスワードを確認して変更できる', async () => {
  const user = userEvent.setup()
  renderAccount()

  await user.click(screen.getByText('ログイン情報'))
  await user.type(screen.getByLabelText('現在のパスワード'), 'Current-123!')
  await user.type(screen.getByLabelText('新しいパスワード'), 'Changed-123!')
  await user.type(screen.getByLabelText('新しいパスワード（確認）'), 'Changed-123!')
  await user.click(screen.getByRole('button', { name: 'パスワードを変更' }))

  expect(updateAccountPassword).toHaveBeenCalledWith(
    'Current-123!',
    'Changed-123!',
    'e2e-turnstile-token',
  )
  expect(await screen.findByText('パスワードを変更しました。')).toBeVisible()
})

test('アカウント削除の再認証へTurnstile tokenを渡す', async () => {
  const user = userEvent.setup()
  renderAccount()

  await user.click(screen.getByRole('button', { name: '削除手続きを始める' }))
  await user.type(screen.getByLabelText('パスワード'), 'Password-123!')
  await user.click(screen.getByRole('button', { name: 'パスワードで再認証' }))

  expect(signIn).toHaveBeenCalledWith(
    'owner@example.test',
    'Password-123!',
    'e2e-turnstile-token',
  )
  expect(await screen.findByRole('button', { name: '削除を実行' })).toBeVisible()
})
