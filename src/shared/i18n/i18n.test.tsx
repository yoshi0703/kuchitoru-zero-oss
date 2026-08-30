import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import { I18nProvider, LOCALE_STORAGE_KEY, localeFromLanguages, useI18n } from '.'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = 'ja'
  document.head.querySelector('meta[name="description"]')?.remove()
  const meta = document.createElement('meta')
  meta.name = 'description'
  document.head.append(meta)
})

test('language subtags are inspected in order with Japanese fallback', () => {
  expect(localeFromLanguages(['fr-FR', 'en-GB', 'ja-JP'])).toBe('en')
  expect(localeFromLanguages(['fr-FR'])).toBe('ja')
})

test('a valid stored preference wins and unsupported storage is ignored', () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  function Probe() { const { locale } = useI18n(); return <span>{locale}</span> }
  const view = render(<I18nProvider><Probe /></I18nProvider>)
  expect(screen.getByText('en')).toBeVisible()
  view.unmount()
  localStorage.setItem(LOCALE_STORAGE_KEY, '{bad')
  expect(localeFromLanguages(['ja-JP'])).toBe('ja')
})

test('explicit changes persist and synchronize document metadata', async () => {
  function Probe() { const { setLocale } = useI18n(); return <button onClick={() => setLocale('en')}>English</button> }
  render(<I18nProvider><Probe /></I18nProvider>)
  await userEvent.click(screen.getByRole('button'))
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  expect(document.documentElement.lang).toBe('en')
  expect(document.title).toBe('Kuchitoru Zero')
  expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', expect.stringContaining('free web app'))
})
