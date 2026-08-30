export const SUPPORTED_LOCALES = ['ja', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_STORAGE_KEY = 'kuchitoru.locale'

export function parseLocale(value: unknown): Locale | null {
  return value === 'ja' || value === 'en' ? value : null
}

export function localeFromLanguages(languages: readonly string[]): Locale {
  for (const language of languages) {
    const locale = parseLocale(language.toLowerCase().split('-')[0])
    if (locale) return locale
  }
  return 'ja'
}

export function detectLocale(): Locale {
  try {
    const stored = parseLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
    if (stored) return stored
  } catch {
    // Browser storage can be unavailable; language detection still works.
  }
  return localeFromLanguages(navigator.languages ?? [navigator.language])
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // The in-memory preference remains usable when storage is unavailable.
  }
}

export const localeTag = (locale: Locale): 'ja-JP' | 'en-US' => locale === 'ja' ? 'ja-JP' : 'en-US'
