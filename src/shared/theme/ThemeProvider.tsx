import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DARK_MODE_QUERY,
  THEME_STORAGE_KEY,
  isThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from './theme'
import { ThemeContext } from './theme-context'

function getStoredMode(): ThemeMode {
  const domMode = document.documentElement.dataset.themeMode ?? null
  if (isThemeMode(domMode)) return domMode

  try {
    const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(storedMode) ? storedMode : 'system'
  } catch {
    return 'system'
  }
}

function getSystemPrefersDark() {
  return window.matchMedia(DARK_MODE_QUERY).matches
}

function applyTheme(mode: ThemeMode, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme
  root.dataset.themeMode = mode
  root.style.colorScheme = resolvedTheme

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', resolvedTheme === 'dark' ? '#111111' : '#115e59')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)
  const resolvedTheme = resolveTheme(mode, systemPrefersDark)

  useEffect(() => {
    const media = window.matchMedia(DARK_MODE_QUERY)
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    applyTheme(mode, resolvedTheme)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      // The theme remains usable when storage is unavailable.
    }
  }, [mode, resolvedTheme])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isThemeMode(event.newValue)) setMode(event.newValue)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
