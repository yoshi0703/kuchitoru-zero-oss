import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../features/auth/auth-context'
import { useI18n } from '../shared/i18n'
import { LoadingState, Notice } from '../shared/ui/ui'

export function RequireAuth() {
  const { text } = useI18n()
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <main className="route-loading"><LoadingState label={text({ ja: '認証を確認しています', en: 'Checking authentication' })} /></main>
  }
  if (status === 'unconfigured') {
    return <main className="route-loading"><Notice tone="error">{text({ ja: 'サービス設定を確認してください。Supabaseの公開設定が不足しています。', en: 'Please check the service configuration. The public Supabase configuration is incomplete.' })}</Notice></main>
  }
  if (status !== 'authenticated') {
    return <Navigate replace to="/login" state={{ returnTo: `${location.pathname}${location.search}` }} />
  }
  return <Outlet />
}
