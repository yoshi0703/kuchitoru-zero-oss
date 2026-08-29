import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { AppFooter, BrandMark, Button, Notice } from '../../shared/ui/ui'
import { TurnstileWidget } from '../../shared/ui/TurnstileWidget'
import { runtimeConfig } from '../../shared/config/runtime'
import { useAuth } from './auth-context'
import {
  PASSWORD_REQUIREMENTS,
  PASSWORD_REQUIREMENTS_ERROR,
  passwordMeetsRequirements,
} from './password-policy'
import { safeReturnPath } from './safe-return-path'
import { useI18n } from '../../shared/i18n'

const authErrorEnglish: Readonly<Record<string, string>> = {
  'メールアドレスまたはパスワードを確認してください。': 'Please check your email address and password.',
  'Googleログインを開始できませんでした。': 'Could not start Google sign-in.',
  '登録できませんでした。入力内容を確認してください。': 'Registration failed. Please check your information.',
  '再設定メールを送信できませんでした。時間をおいて再度お試しください。': 'Could not send the reset email. Please try again later.',
  'パスワードを更新できませんでした。再設定メールのリンクを開き直してください。': 'Could not update the password. Please reopen the link in the reset email.',
}

function authPresentationError(locale: 'ja' | 'en', caught: unknown, fallback: { ja: string; en: string }) {
  if (!(caught instanceof Error)) return fallback[locale]
  if (locale === 'ja') return caught.message
  return authErrorEnglish[caught.message] ?? fallback.en
}

const emailSchema = z.object({
  email: z.email('メールアドレスを入力してください。'),
})
const loginSchema = emailSchema.extend({
  password: z.string().min(1, 'パスワードを入力してください。'),
})
const newPasswordSchema = z.object({
  password: z.string().refine(
    passwordMeetsRequirements,
    PASSWORD_REQUIREMENTS_ERROR,
  ),
})
const registrationSchema = emailSchema.extend(newPasswordSchema.shape)
type AuthValues = z.infer<typeof loginSchema>
type RegistrationValues = z.infer<typeof registrationSchema>
type EmailValues = z.infer<typeof emailSchema>
type PasswordValues = z.infer<typeof newPasswordSchema>

function PasswordField({
  registration,
  error,
  autoComplete,
  showRequirements = false,
}: {
  registration: UseFormRegisterReturn<'password'>
  error: string | undefined
  autoComplete: 'current-password' | 'new-password'
  showRequirements?: boolean
}) {
  const { text } = useI18n()
  const [visible, setVisible] = useState(false)
  const inputId = autoComplete === 'current-password' ? 'current-password' : 'new-password'
  const requirementsId = showRequirements ? 'password-requirements' : undefined
  const errorId = error ? 'password-error' : undefined
  return (
    <div className="password-control">
      <label htmlFor={inputId}>{text({ ja: 'パスワード', en: 'Password' })}</label>
      <span className="password-field">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-describedby={[requirementsId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={Boolean(error)}
          {...registration}
        />
        <button type="button" aria-label={visible ? text({ ja: 'パスワードを隠す', en: 'Hide password' }) : text({ ja: 'パスワードを表示', en: 'Show password' })} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff /> : <Eye />}</button>
      </span>
      {showRequirements ? <span id={requirementsId} className="field-help password-requirements">{text({ ja: PASSWORD_REQUIREMENTS, en: 'Use at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.' })}</span> : null}
      {error ? <span id={errorId} className="field-error">{text({ ja: error, en: error === PASSWORD_REQUIREMENTS_ERROR ? 'The password does not meet the requirements.' : error })}</span> : null}
    </div>
  )
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <header className="auth-shell__toolbar"><BrandMark /></header>
      <div className="auth-shell__stage">
        <section className="auth-panel">{children}</section>
      </div>
      <AppFooter />
    </main>
  )
}

export function LoginPage() {
  const { locale, text } = useI18n()
  const { status, signIn, signInWithGoogle, resendSignupConfirmation } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const updateCaptchaToken = useCallback((token: string) => setCaptchaToken(token), [])
  const resetCaptcha = useCallback(() => {
    setCaptchaToken('')
    setCaptchaAttempt((value) => value + 1)
  }, [])
  const { register, handleSubmit, formState, getValues } = useForm<AuthValues>({ resolver: zodResolver(loginSchema) })

  if (status === 'authenticated') return <Navigate replace to="/dashboard" />

  const submit = handleSubmit(async (values) => {
    setError('')
    setConfirmationMessage('')
    try {
      await signIn(values.email, values.password, captchaToken)
      const state = location.state as { returnTo?: string } | null
      void navigate(state?.returnTo ?? '/dashboard', { replace: true })
    } catch (caught) {
      setError(authPresentationError(locale, caught, { ja: 'ログインできませんでした。', en: 'Could not sign in.' }))
    } finally {
      resetCaptcha()
    }
  })

  return (
    <AuthShell>
      <header className="auth-panel__header"><h1>{text({ ja: 'ログイン', en: 'Sign in' })}</h1></header>
      {status === 'unconfigured' ? <Notice tone="error">{text({ ja: '認証サービスが設定されていません。', en: 'Authentication service is not configured.' })}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {confirmationMessage ? <Notice tone="success">{confirmationMessage}</Notice> : null}
      <form className="form-stack" onSubmit={submit}>
        <label>
          {text({ ja: 'メールアドレス', en: 'Email address' })}
          <input type="email" autoComplete="email" {...register('email')} />
          {formState.errors.email ? <span className="field-error">{locale === 'ja' ? formState.errors.email.message : 'Enter your email address.'}</span> : null}
        </label>
        <PasswordField registration={register('password')} autoComplete="current-password" error={formState.errors.password?.message} />
        <TurnstileWidget key={captchaAttempt} action="auth_login" onToken={updateCaptchaToken} />
        <Button type="submit" busy={formState.isSubmitting} disabled={status === 'unconfigured' || !captchaToken}>{text({ ja: 'ログイン', en: 'Sign in' })}</Button>
      </form>
      <p className="auth-switch">{text({ ja: '確認メールが届かない方', en: 'Did not receive a confirmation email?' })}</p>
      <Button
        type="button"
        variant="secondary"
        busy={confirmationBusy}
        disabled={status === 'unconfigured' || !captchaToken}
        onClick={() => {
          setError('')
          setConfirmationMessage('')
          const result = emailSchema.safeParse({ email: getValues('email') })
          if (!result.success) {
            setError(text({ ja: '確認メールを再送するメールアドレスを入力してください。', en: 'Enter the email address that should receive the confirmation email.' }))
            return
          }
          setConfirmationBusy(true)
          void resendSignupConfirmation(result.data.email, captchaToken)
            .catch(() => undefined)
            .then(() => setConfirmationMessage(text({ ja: '入力したアドレスが登録済みで未確認の場合、確認メールを送信します。届かない場合は迷惑メールと入力内容を確認し、時間をおいて再試行してください。', en: 'If the address is registered but unconfirmed, we will send a confirmation email. Check spam and your entry, then try again later if needed.' })))
            .finally(() => {
              setConfirmationBusy(false)
              resetCaptcha()
            })
        }}
      >
        {text({ ja: '確認メールを再送', en: 'Resend confirmation email' })}
      </Button>
      {runtimeConfig.googleAuthEnabled ? (
        <>
          <div className="auth-divider"><span>{text({ ja: 'または', en: 'or' })}</span></div>
          <Button
            variant="secondary"
            disabled={status === 'unconfigured'}
            onClick={() => void signInWithGoogle().catch((caught: unknown) => setError(authPresentationError(locale, caught, { ja: 'Googleログインを開始できませんでした。', en: 'Could not start Google sign-in.' })))}
          >
            {text({ ja: 'Googleで続ける', en: 'Continue with Google' })}
          </Button>
        </>
      ) : null}
      <p className="auth-switch"><Link to="/forgot-password">{text({ ja: 'パスワードをお忘れの方', en: 'Forgot your password?' })}</Link></p>
      <p className="auth-switch">{text({ ja: 'はじめての方は ', en: 'New here? ' })}<Link to="/register">{text({ ja: 'アカウントを作成', en: 'Create an account' })}</Link></p>
    </AuthShell>
  )
}

export function RegisterPage() {
  const { locale, text } = useI18n()
  const { status, signUp } = useAuth()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const updateCaptchaToken = useCallback((token: string) => setCaptchaToken(token), [])
  const resetCaptcha = useCallback(() => {
    setCaptchaToken('')
    setCaptchaAttempt((value) => value + 1)
  }, [])
  const { register, handleSubmit, formState } = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
  })

  if (status === 'authenticated') return <Navigate replace to="/dashboard" />

  return (
    <AuthShell>
      <header className="auth-panel__header"><h1>{text({ ja: 'アカウントを作成', en: 'Create an account' })}</h1></header>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form
        className="form-stack"
        onSubmit={handleSubmit(async (values) => {
          setError('')
          try {
            await signUp(values.email, values.password, captchaToken)
            setMessage(text({ ja: '確認メールを送信しました。メール内のリンクから登録を完了してください。', en: 'We sent a confirmation email. Follow its link to finish registration.' }))
          } catch (caught) {
            setError(authPresentationError(locale, caught, { ja: '登録できませんでした。', en: 'Could not register.' }))
          } finally {
            resetCaptcha()
          }
        })}
      >
        <label>{text({ ja: 'メールアドレス', en: 'Email address' })}<input type="email" autoComplete="email" {...register('email')} />{formState.errors.email ? <span className="field-error">{locale === 'ja' ? formState.errors.email.message : 'Enter your email address.'}</span> : null}</label>
        <PasswordField registration={register('password')} autoComplete="new-password" error={formState.errors.password?.message} showRequirements />
        <TurnstileWidget key={captchaAttempt} action="auth_signup" onToken={updateCaptchaToken} />
        <Button type="submit" busy={formState.isSubmitting} disabled={status === 'unconfigured' || !captchaToken}>{text({ ja: 'アカウントを作成', en: 'Create account' })}</Button>
      </form>
      <p className="auth-switch">{text({ ja: '登録済みの方は ', en: 'Already registered? ' })}<Link to="/login">{text({ ja: 'ログイン', en: 'Sign in' })}</Link></p>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const { locale, text } = useI18n()
  const { requestPasswordReset, status } = useAuth()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const updateCaptchaToken = useCallback((token: string) => setCaptchaToken(token), [])
  const resetCaptcha = useCallback(() => {
    setCaptchaToken('')
    setCaptchaAttempt((value) => value + 1)
  }, [])
  const { register, handleSubmit, formState } = useForm<EmailValues>({ resolver: zodResolver(emailSchema) })

  return (
    <AuthShell>
      <header className="auth-panel__header"><p className="auth-panel__eyebrow">{text({ ja: 'アカウント復旧', en: 'Account recovery' })}</p><h1>{text({ ja: 'パスワードを再設定', en: 'Reset your password' })}</h1><p className="muted">{text({ ja: '登録したメールアドレスへ、再設定用のリンクを送ります。', en: 'We will send a reset link to your registered email address.' })}</p></header>
      {status === 'unconfigured' ? <Notice tone="error">{text({ ja: '認証サービスが設定されていません。', en: 'Authentication service is not configured.' })}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!message ? (
        <form className="form-stack" onSubmit={handleSubmit(async ({ email }) => {
          setError('')
          try {
            await requestPasswordReset(email, captchaToken)
            setMessage(text({ ja: 'メールを送信しました。届いたリンクからパスワードを再設定してください。', en: 'Email sent. Use the link in it to reset your password.' }))
          } catch (caught) {
            setError(authPresentationError(locale, caught, { ja: '再設定メールを送信できませんでした。', en: 'Could not send the reset email.' }))
          } finally {
            resetCaptcha()
          }
        })}>
          <label>{text({ ja: 'メールアドレス', en: 'Email address' })}<input type="email" autoComplete="email" {...register('email')} />{formState.errors.email ? <span className="field-error">{locale === 'ja' ? formState.errors.email.message : 'Enter your email address.'}</span> : null}</label>
          <TurnstileWidget key={captchaAttempt} action="auth_password_reset" onToken={updateCaptchaToken} />
          <Button type="submit" busy={formState.isSubmitting} disabled={status === 'unconfigured' || !captchaToken}>{text({ ja: '再設定メールを送る', en: 'Send reset email' })}</Button>
        </form>
      ) : null}
      <p className="auth-switch"><Link to="/login">{text({ ja: 'ログインへ戻る', en: 'Back to sign in' })}</Link></p>
    </AuthShell>
  )
}

export function UpdatePasswordPage() {
  const { locale, text } = useI18n()
  const { passwordRecoveryReady, updatePassword, status } = useAuth()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const { register, handleSubmit, formState } = useForm<PasswordValues>({ resolver: zodResolver(newPasswordSchema) })
  const canUpdatePassword = status === 'authenticated' && passwordRecoveryReady

  return (
    <AuthShell>
      <header className="auth-panel__header"><p className="auth-panel__eyebrow">{text({ ja: 'アカウント復旧', en: 'Account recovery' })}</p><h1>{text({ ja: '新しいパスワード', en: 'New password' })}</h1><p className="muted">{text({ ja: '安全な新しいパスワードを設定してください。', en: 'Choose a secure new password.' })}</p></header>
      {status === 'unconfigured' ? <Notice tone="error">{text({ ja: '認証サービスが設定されていません。', en: 'Authentication service is not configured.' })}</Notice> : null}
      {status === 'loading' ? <p role="status">{text({ ja: '再設定リンクを確認しています。', en: 'Checking the reset link.' })}</p> : null}
      {!message && status !== 'loading' && status !== 'unconfigured' && !canUpdatePassword ? (
        <Notice tone="error">{text({ ja: '再設定リンクの有効期限が切れているか、確認できません。', en: 'The reset link has expired or could not be verified. ' })}<Link to="/forgot-password">{text({ ja: '再設定メールを送り直してください。', en: 'Request another reset email.' })}</Link></Notice>
      ) : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!message && canUpdatePassword ? (
        <form className="form-stack" onSubmit={handleSubmit(async ({ password }) => {
          setError('')
          try {
            await updatePassword(password)
            setMessage(text({ ja: 'パスワードを更新しました。管理画面へ進めます。', en: 'Your password was updated. You can continue to the dashboard.' }))
          } catch (caught) {
            setError(authPresentationError(locale, caught, { ja: 'パスワードを更新できませんでした。', en: 'Could not update the password.' }))
          }
        })}>
          <PasswordField registration={register('password')} autoComplete="new-password" error={formState.errors.password?.message} showRequirements />
          <Button type="submit" busy={formState.isSubmitting}>{text({ ja: 'パスワードを更新', en: 'Update password' })}</Button>
        </form>
      ) : null}
      <p className="auth-switch"><Link to={message ? '/dashboard' : '/login'}>{message ? text({ ja: '管理画面へ進む', en: 'Continue to dashboard' }) : text({ ja: 'ログインへ戻る', en: 'Back to sign in' })}</Link></p>
    </AuthShell>
  )
}

export function AuthCallbackPage() {
  const { text } = useI18n()
  const { status } = useAuth()
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const returnTo = searchParams.get('returnTo')
    const safeReturnTo = safeReturnPath(returnTo)
    if (status === 'authenticated') window.setTimeout(() => window.location.replace(safeReturnTo), 300)
  }, [status, searchParams])
  return (
    <AuthShell>
      <header className="auth-panel__header"><p className="auth-panel__eyebrow">{text({ ja: 'セキュリティ確認', en: 'Security check' })}</p><h1>{text({ ja: '認証を確認しています', en: 'Checking authentication' })}</h1></header>
      {status === 'anonymous' || status === 'unconfigured' ? (
        <Notice tone="error">{text({ ja: '認証リンクを確認できませんでした。', en: 'We could not verify the authentication link. ' })}<Link to="/login">{text({ ja: 'ログインへ戻る', en: 'Back to sign in' })}</Link></Notice>
      ) : <p role="status">{text({ ja: 'このままお待ちください。', en: 'Please wait.' })}</p>}
    </AuthShell>
  )
}
