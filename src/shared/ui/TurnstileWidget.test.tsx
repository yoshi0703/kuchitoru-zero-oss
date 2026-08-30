import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { I18nProvider, LOCALE_STORAGE_KEY, type Locale } from '../i18n'

const { testRuntimeConfig } = vi.hoisted(() => ({
  testRuntimeConfig: {
    isE2ETestMode: false,
    turnstileSiteKey: 'production-site-key',
  },
}))

vi.mock('../config/runtime', () => ({ runtimeConfig: testRuntimeConfig }))

import { TurnstileWidget } from './TurnstileWidget'

function renderWidget(locale: Locale, onToken = vi.fn()) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(<I18nProvider><TurnstileWidget action="auth_signup" onToken={onToken} /></I18nProvider>)
}

beforeEach(() => {
  document.head.querySelector('script[data-kuchitoru-turnstile]')?.remove()
  delete window.turnstile
  testRuntimeConfig.turnstileSiteKey = 'production-site-key'
})

afterEach(() => {
  document.head.querySelector('script[data-kuchitoru-turnstile]')?.remove()
  delete window.turnstile
})

test('指定actionでwidgetを描画し、成功・期限切れを親へ通知する', () => {
  const onToken = vi.fn()
  let options: Record<string, unknown> = {}
  window.turnstile = {
    render: vi.fn((_container, nextOptions) => {
      options = nextOptions
      return 'widget-1'
    }),
    remove: vi.fn(),
  }
  const script = document.createElement('script')
  script.dataset.kuchitoruTurnstile = 'true'
  document.head.append(script)

  const { unmount } = renderWidget('ja', onToken)

  expect(screen.getByLabelText('セキュリティ確認')).toBeVisible()
  expect(window.turnstile.render).toHaveBeenCalled()
  expect(options.sitekey).toBe('production-site-key')
  expect(options.action).toBe('auth_signup')

  act(() => (options.callback as (token: string) => void)('verified-token'))
  expect(onToken).toHaveBeenCalledWith('verified-token')
  act(() => (options['expired-callback'] as () => void)())
  expect(onToken).toHaveBeenLastCalledWith('')

  unmount()
  expect(window.turnstile.remove).toHaveBeenCalledWith('widget-1')
})

test.each([
  ['ja', 'セキュリティ確認'],
  ['en', 'Security check'],
] as const)('localizes the Turnstile aria label in %s', (locale, label) => {
  renderWidget(locale)
  expect(screen.getByLabelText(label)).toBeVisible()
})

test.each([
  ['ja', 'セキュリティ確認を読み込めませんでした。'],
  ['en', 'Could not load the security check.'],
] as const)('localizes missing configuration in %s without loading a script', (locale, message) => {
  testRuntimeConfig.turnstileSiteKey = ''
  renderWidget(locale)

  expect(screen.getByRole('alert')).toHaveTextContent(message)
  expect(document.head.querySelector('script[data-kuchitoru-turnstile]')).toBeNull()
})
