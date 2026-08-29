import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLocale, localeTag, persistLocale, type Locale } from './locale'

type LocalizedText = Readonly<Record<Locale, string>>
type I18nValue = {
  locale: Locale
  localeTag: 'ja-JP' | 'en-US'
  setLocale: (locale: Locale) => void
  text: (copy: LocalizedText) => string
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
}

const I18nContext = createContext<I18nValue | null>(null)
const metadata: Record<Locale, { title: string; description: string }> = {
  ja: { title: 'クチトルZero', description: 'クチトルZero — QRコードでお客様の声を集め、本人の回答をもとに口コミ文を整えるセルフホスト対応Webアプリ' },
  en: { title: 'Kuchitoru Zero', description: 'Kuchitoru Zero — a free web app that collects customer feedback by QR code and helps shape reviews from their own answers' },
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)
  const setLocale = useCallback((next: Locale) => { persistLocale(next); setLocaleState(next) }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = metadata[locale].title
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', metadata[locale].description)
  }, [locale])

  const value = useMemo<I18nValue>(() => ({
    locale,
    localeTag: localeTag(locale),
    setLocale,
    text: (copy) => copy[locale],
    formatDate: (input, options) => new Intl.DateTimeFormat(localeTag(locale), options).format(input),
    formatNumber: (input, options) => new Intl.NumberFormat(localeTag(locale), options).format(input),
  }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
