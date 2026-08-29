import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { ContactPage, LandingPage, NotFoundPage, SurveyPreviewMock } from './PublicPages'

vi.mock('../../shared/config/runtime', () => ({
  runtimeConfig: { isE2ETestMode: true, turnstileSiteKey: '', supabaseUrl: '', supabasePublishableKey: '' },
}))
const renderEnglish = (node: React.ReactNode) => {
  localStorage.setItem('kuchitoru.locale', 'en')
  return render(<I18nProvider><MemoryRouter>{node}</MemoryRouter></I18nProvider>)
}

const expectNoJapaneseChrome = (container: HTMLElement) => {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.app-footer').forEach((node) => node.remove())
  const accessible = [...clone.querySelectorAll('*')].flatMap((node) => ['aria-label', 'title', 'alt'].map((name) => node.getAttribute(name) ?? '')).join(' ')
  expect(`${clone.textContent} ${accessible}`).not.toMatch(/[ぁ-んァ-ン一-龯]/)
}

beforeEach(() => {
  localStorage.clear()
})

describe('English public presentation', () => {
  it('renders the primary landing proposition and navigation', () => {
    const { container } = renderEnglish(<LandingPage />)
    expect(screen.getByRole('heading', { name: /Turn customer experiences/ })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'A self-hosted Community edition' })).toBeVisible()
    expectNoJapaneseChrome(container)
  })

  it('preserves survey selection, transition, clipboard, and reset behavior', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = renderEnglish(<SurveyPreviewMock />)
    await user.click(screen.getByLabelText('First visit'))
    expect(screen.getByLabelText('First visit')).toBeChecked()
    await user.click(screen.getByRole('button', { name: '5' }))
    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /Submit answers/ }))
    expect(screen.getByText(/^\d+ \/ 800 characters$/)).toBeVisible()
    expectNoJapaneseChrome(container)
    await user.click(screen.getByRole('button', { name: /Copy text/ }))
    expect(writeText).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /Finish without posting/ }))
    expect(screen.getByRole('heading', { name: 'Tell us about your visit' })).toBeVisible()
  })

  it('separates Community, security, and Hosted support channels', () => {
    const { container } = renderEnglish(<ContactPage />)
    expect(screen.getByRole('link', { name: 'GitHub Issues' })).toHaveAttribute('href', 'https://github.com/yoshi0703/kuchitoru-zero-oss/issues')
    expect(screen.getByRole('link', { name: 'Report privately' })).toHaveAttribute('href', 'https://github.com/yoshi0703/kuchitoru-zero-oss/security/advisories/new')
    expect(screen.getByRole('link', { name: 'Contact Hosted support' })).toHaveAttribute('href', 'https://app.kuchitoru.com/contact')
    expectNoJapaneseChrome(container)
  })

  it('renders the English not-found route', () => {
    renderEnglish(<NotFoundPage />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/')
  })
})
