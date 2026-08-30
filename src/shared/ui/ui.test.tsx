import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MemoryRouter } from 'react-router'
import { I18nProvider, LOCALE_STORAGE_KEY, type Locale } from '../i18n'
import { AppFooter, BrandMark, Button, GroupedSection, LoadingState } from './ui'

function renderLocalized(locale: Locale, element: React.ReactNode) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(<I18nProvider><MemoryRouter>{element}</MemoryRouter></I18nProvider>)
}

describe('GroupedSection', () => {
  test('見出しと内容を関連付けたグループとして表示する', () => {
    render(
      <GroupedSection title="基本設定" headingId="basic-settings">
        <p>設定内容</p>
      </GroupedSection>,
    )

    expect(screen.getByRole('region', { name: '基本設定' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '基本設定' })).toHaveAttribute('id', 'basic-settings')
    expect(screen.getByText('設定内容')).toBeVisible()
  })
})

describe('Button', () => {
  test('animated option keeps the button contract and busy state', () => {
    render(<Button animated busy>公開する</Button>)

    const button = screen.getByRole('button', { name: '公開する' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})

describe.each([
  ['ja', 'クチトルZero トップページ', '読み込んでいます', 'サポート', '商標条件'],
  ['en', 'Kuchitoru Zero home page', 'Loading', 'Support', 'Trademark policy'],
] as const)('shared copy in %s', (locale, homeLabel, loadingLabel, contactLabel, trademarkLabel) => {
  test('localizes the brand and default loading copy while preserving routes and passed labels', () => {
    renderLocalized(locale, <><BrandMark compact /><LoadingState /><LoadingState label="Custom status" /></>)

    expect(screen.getByRole('link', { name: homeLabel })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: homeLabel })).toHaveClass('brand--compact')
    expect(screen.getByText(loadingLabel)).toBeVisible()
    expect(screen.getByText('Custom status')).toBeVisible()
  })

  test('Community版のソース、ライセンス、商標条件を共通フッターに表示する', () => {
    renderLocalized(locale, <AppFooter />)

    expect(screen.getByRole('link', { name: contactLabel })).toHaveAttribute('href', '/contact')
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://github.com/yoshi0703/kuchitoru-zero-oss')
    expect(screen.getByRole('link', { name: 'GNU AGPL v3 or later' })).toHaveAttribute('href', 'https://github.com/yoshi0703/kuchitoru-zero-oss/blob/main/LICENSE')
    expect(screen.getByRole('link', { name: trademarkLabel })).toHaveAttribute('href', 'https://github.com/yoshi0703/kuchitoru-zero-oss/blob/main/TRADEMARKS.md')
    expect(screen.getByText('© 2026 Ranchu Japan合同会社')).toBeVisible()
  })
})
