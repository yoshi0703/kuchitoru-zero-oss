import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { runtimeConfig } from '../../shared/config/runtime'
import { useI18n, type Locale } from '../../shared/i18n'
import { parseLocale } from '../../shared/i18n/locale'
import { supabase } from '../../shared/api/supabase'
import { safeReturnPath } from './safe-return-path'
import {
  clearPasswordRecoveryMarker,
  e2ePasswordRecoveryIsExplicitlyEnabled,
  markPasswordRecoveryReady,
  passwordRecoveryMarkerIsFresh,
} from './password-recovery-state'

type AuthUser = {
  id: string
  email: string | null
  language: Locale | null
}
type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unconfigured'

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  passwordRecoveryReady: boolean
  signIn: (email: string, password: string, captchaToken: string) => Promise<void>
  signUp: (email: string, password: string, captchaToken: string) => Promise<void>
  signInWithGoogle: (returnTo?: string) => Promise<void>
  resendSignupConfirmation: (email: string, captchaToken: string) => Promise<void>
  requestPasswordReset: (email: string, captchaToken: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  updateAccountEmail: (email: string) => Promise<void>
  updateAccountPassword: (currentPassword: string, newPassword: string, captchaToken: string) => Promise<void>
  updateAccountLanguage: (locale: Locale) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const authCallbackUrl = (returnTo: string) => (
  `${runtimeConfig.appOrigin}/auth/callback?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`
)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useI18n()
  const authError = useCallback((ja: string, en: string) => new Error(locale === 'ja' ? ja : en), [locale])
  const [status, setStatus] = useState<AuthStatus>(
    runtimeConfig.isE2ETestMode ? 'authenticated' : supabase === null ? 'unconfigured' : 'loading',
  )
  const [user, setUser] = useState<AuthUser | null>(
    runtimeConfig.isE2ETestMode ? { id: 'e2e-owner', email: 'owner@example.test', language: null } : null,
  )
  const [passwordRecoveryReady, setPasswordRecoveryReady] = useState(
    () => e2ePasswordRecoveryIsExplicitlyEnabled(runtimeConfig.isE2ETestMode)
      || passwordRecoveryMarkerIsFresh(),
  )

  useEffect(() => {
    if (runtimeConfig.isE2ETestMode || supabase === null) return

    void supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user
      const language = parseLocale(nextUser?.user_metadata?.language)
      setUser(nextUser ? {
        id: nextUser.id,
        email: nextUser.email ?? null,
        language,
      } : null)
      if (language) setLocale(language)
      setStatus(nextUser ? 'authenticated' : 'anonymous')
    }).catch(() => setStatus('anonymous'))

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        markPasswordRecoveryReady()
        setPasswordRecoveryReady(true)
      } else if (event === 'SIGNED_OUT') {
        clearPasswordRecoveryMarker()
        setPasswordRecoveryReady(false)
      }
      const nextUser = session?.user
      const language = parseLocale(nextUser?.user_metadata?.language)
      setUser(nextUser ? {
        id: nextUser.id,
        email: nextUser.email ?? null,
        language,
      } : null)
      if (language) setLocale(language)
      setStatus(nextUser ? 'authenticated' : 'anonymous')
    })
    return () => data.subscription.unsubscribe()
  }, [setLocale])

  const signIn = useCallback(async (email: string, password: string, captchaToken: string) => {
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    })
    if (error) throw authError('メールアドレスまたはパスワードを確認してください。', 'Please check your email address and password.')
    clearPasswordRecoveryMarker()
    setPasswordRecoveryReady(false)
  }, [authError])

  const signUp = useCallback(async (email: string, password: string, captchaToken: string) => {
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken,
        emailRedirectTo: authCallbackUrl('/dashboard'),
        data: { language: locale },
      },
    })
    if (error) throw authError('登録できませんでした。入力内容を確認してください。', 'Registration failed. Please check your information.')
    clearPasswordRecoveryMarker()
    setPasswordRecoveryReady(false)
  }, [locale, authError])

  const signInWithGoogle = useCallback(async (returnTo = '/dashboard') => {
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    if (!runtimeConfig.googleAuthEnabled) throw authError('Googleログインは現在利用できません。', 'Google sign-in is currently unavailable.')
    clearPasswordRecoveryMarker()
    setPasswordRecoveryReady(false)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authCallbackUrl(returnTo) },
    })
    if (error) throw authError('Googleログインを開始できませんでした。', 'Could not start Google sign-in.')
  }, [authError])

  const resendSignupConfirmation = useCallback(async (email: string, captchaToken: string) => {
    if (runtimeConfig.isE2ETestMode) return
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        captchaToken,
        emailRedirectTo: authCallbackUrl('/dashboard'),
      },
    })
    if (error) throw authError('確認メールを再送できませんでした。時間をおいて再度お試しください。', 'Could not resend the confirmation email. Please try again later.')
  }, [authError])

  const requestPasswordReset = useCallback(async (email: string, captchaToken: string) => {
    if (runtimeConfig.isE2ETestMode) return
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    clearPasswordRecoveryMarker()
    setPasswordRecoveryReady(false)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      captchaToken,
      redirectTo: `${runtimeConfig.appOrigin}/auth/update-password`,
    })
    if (error) throw authError('再設定メールを送信できませんでした。時間をおいて再度お試しください。', 'Could not send the reset email. Please try again later.')
  }, [authError])

  const updatePassword = useCallback(async (password: string) => {
    if (!passwordRecoveryReady) {
      throw authError('再設定リンクの有効期限が切れているか、確認できません。再設定メールを送り直してください。', 'The reset link has expired or could not be verified. Please request another reset email.')
    }
    if (runtimeConfig.isE2ETestMode) {
      clearPasswordRecoveryMarker()
      setPasswordRecoveryReady(false)
      return
    }
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw authError('パスワードを更新できませんでした。再設定メールのリンクを開き直してください。', 'Could not update the password. Please reopen the link in the reset email.')
    clearPasswordRecoveryMarker()
    setPasswordRecoveryReady(false)
  }, [passwordRecoveryReady, authError])

  const updateAccountEmail = useCallback(async (email: string) => {
    if (runtimeConfig.isE2ETestMode) return
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: authCallbackUrl('/account') },
    )
    if (error) throw authError('メールアドレスを変更できませんでした。入力内容を確認して、時間をおいて再度お試しください。', 'Could not change the email address. Check your entry and try again later.')
  }, [authError])

  const updateAccountPassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
    captchaToken: string,
  ) => {
    if (runtimeConfig.isE2ETestMode) return
    if (supabase === null) throw authError('認証サービスが設定されていません。', 'Authentication service is not configured.')
    if (!user?.email) throw authError('パスワードを変更できないアカウントです。', 'This account cannot change its password.')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
      options: { captchaToken },
    })
    if (signInError) throw authError('現在のパスワードを確認してください。', 'Please check your current password.')

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw authError('パスワードを変更できませんでした。時間をおいて再度お試しください。', 'Could not change the password. Please try again later.')
  }, [user, authError])

  const updateAccountLanguage = useCallback(async (nextLocale: Locale) => {
    if (nextLocale === locale) return
    if (!runtimeConfig.isE2ETestMode) {
      if (supabase === null) throw new Error(locale === 'ja' ? '認証サービスが設定されていません。' : 'Authentication service is not configured.')
      const { error } = await supabase.auth.updateUser({ data: { language: nextLocale } })
      if (error) throw new Error(locale === 'ja' ? '言語設定を更新できませんでした。' : 'Could not update the language setting.')
    }
    setLocale(nextLocale)
    setUser((current) => current ? { ...current, language: nextLocale } : current)
  }, [locale, setLocale])

  const signOut = useCallback(async () => {
    clearPasswordRecoveryMarker()
    setPasswordRecoveryReady(false)
    if (runtimeConfig.isE2ETestMode) return
    const { error } = (await supabase?.auth.signOut()) ?? { error: null }
    if (error) throw authError('ログアウトできませんでした。', 'Could not sign out.')
  }, [authError])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, passwordRecoveryReady, signIn, signUp, signInWithGoogle, resendSignupConfirmation, requestPasswordReset, updatePassword, updateAccountEmail, updateAccountPassword, updateAccountLanguage, signOut }),
    [status, user, passwordRecoveryReady, signIn, signUp, signInWithGoogle, resendSignupConfirmation, requestPasswordReset, updatePassword, updateAccountEmail, updateAccountPassword, updateAccountLanguage, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
