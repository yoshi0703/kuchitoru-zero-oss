import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { I18nProvider } from '../shared/i18n'
import { RequireAuth } from './RequireAuth'

const auth = vi.hoisted(() => ({ status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' | 'unconfigured' }))

vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({ status: auth.status }),
}))

function renderProtectedRoute() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/dashboard?from=test']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<h1>管理画面</h1>} />
          </Route>
          <Route path="/login" element={<h1>ログイン</h1>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  auth.status = 'authenticated'
})

test('認証済みなら追加のHosted同意ゲートなしで管理画面を表示する', () => {
  renderProtectedRoute()
  expect(screen.getByRole('heading', { name: '管理画面' })).toBeVisible()
})

test('未認証ならログインへ移動する', () => {
  auth.status = 'anonymous'
  renderProtectedRoute()
  expect(screen.getByRole('heading', { name: 'ログイン' })).toBeVisible()
})

test('認証確認中は保護ページを描画しない', () => {
  auth.status = 'loading'
  renderProtectedRoute()
  expect(screen.getByText('認証を確認しています')).toBeVisible()
  expect(screen.queryByRole('heading', { name: '管理画面' })).not.toBeInTheDocument()
})
