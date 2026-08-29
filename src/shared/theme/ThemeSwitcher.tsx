import { useContext } from 'react'
import { Laptop, Moon, Sun } from 'lucide-react'
import { cx } from '../lib/cx'
import { useI18n, type Locale } from '../i18n'
import { ThemeContext } from './theme-context'
import type { ThemeMode } from './theme'

const options: Array<{ mode: ThemeMode; label: Record<Locale, string>; icon: typeof Sun }> = [
  { mode: 'system', label: { ja: '端末の設定', en: 'System' }, icon: Laptop },
  { mode: 'light', label: { ja: 'ライト', en: 'Light' }, icon: Sun },
  { mode: 'dark', label: { ja: 'ダーク', en: 'Dark' }, icon: Moon },
]

export function ThemeSwitcher({ className }: { className?: string }) {
  const theme = useContext(ThemeContext)
  const { locale, text } = useI18n()
  if (!theme) return null
  const { mode, setMode } = theme

  return (
    <div className={cx('theme-switcher', className)} role="group" aria-label={text({ ja: '表示テーマ', en: 'Display theme' })}>
      {options.map(({ mode: optionMode, label, icon: Icon }) => (
        <button
          key={optionMode}
          type="button"
          className="theme-switcher__option"
          aria-label={locale === 'ja' ? `${label.ja}テーマ` : `${label.en} theme`}
          aria-pressed={mode === optionMode}
          title={label[locale]}
          onClick={() => setMode(optionMode)}
        >
          <Icon aria-hidden="true" />
          <span>{label[locale]}</span>
        </button>
      ))}
    </div>
  )
}
