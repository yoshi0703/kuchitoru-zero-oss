import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { ThemeSwitcher } from './ThemeSwitcher'
import { DARK_MODE_QUERY, THEME_STORAGE_KEY, resolveTheme } from './theme'
import { useTheme } from './useTheme'
import { I18nProvider, LOCALE_STORAGE_KEY, type Locale } from '../i18n'

function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return <I18nProvider><ThemeProvider>{children}</ThemeProvider></I18nProvider>
}

function createMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    get matches() { return matches },
    media: DARK_MODE_QUERY,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  return {
    matchMedia: vi.fn(() => media),
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      listeners.forEach((listener) => listener({ matches: nextMatches, media: DARK_MODE_QUERY } as MediaQueryListEvent))
    },
  }
}

function ThemeProbe() {
  const { mode, resolvedTheme } = useTheme()
  return <output>{mode}:{resolvedTheme}</output>
}

describe('theme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themeMode
    document.documentElement.style.colorScheme = ''
    document.head.innerHTML = '<meta name="theme-color" content="#115e59">'
  })

  it('resolves the system preference without changing explicit modes', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('uses the saved mode and applies it to the document', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const media = createMatchMedia(false)
    vi.stubGlobal('matchMedia', media.matchMedia)

    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)

    expect(screen.getByText('dark:dark')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#111111')
  })

  it('follows OS changes only while system mode is selected', async () => {
    const media = createMatchMedia(false)
    vi.stubGlobal('matchMedia', media.matchMedia)
    const user = userEvent.setup()
    render(<Providers locale="ja"><ThemeSwitcher /><ThemeProbe /></Providers>)

    expect(screen.getByText('system:light')).toBeInTheDocument()
    act(() => media.setMatches(true))
    expect(screen.getByText('system:dark')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ライトテーマ' }))
    expect(screen.getByText('light:light')).toBeInTheDocument()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    act(() => media.setMatches(false))
    act(() => media.setMatches(true))
    expect(screen.getByText('light:light')).toBeInTheDocument()
  })

  it.each([
    ['ja', '表示テーマ', ['端末の設定テーマ', 'ライトテーマ', 'ダークテーマ'], ['端末の設定', 'ライト', 'ダーク']],
    ['en', 'Display theme', ['System theme', 'Light theme', 'Dark theme'], ['System', 'Light', 'Dark']],
  ] as const)('localizes switcher labels and titles in %s while preserving modes', async (locale, groupLabel, buttonLabels, titles) => {
    const media = createMatchMedia(false)
    vi.stubGlobal('matchMedia', media.matchMedia)
    const user = userEvent.setup()
    render(<Providers locale={locale}><ThemeSwitcher /><ThemeProbe /></Providers>)

    expect(screen.getByRole('group', { name: groupLabel })).toBeVisible()
    buttonLabels.forEach((label, index) => {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', titles[index])
    })
    await user.click(screen.getByRole('button', { name: buttonLabels[2] }))
    expect(screen.getByText('dark:dark')).toBeVisible()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })
})
