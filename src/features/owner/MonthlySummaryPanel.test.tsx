import { render as rtlRender, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { MonthlySummary } from './owner-api'
import { MonthlySummaryPanel } from './MonthlySummaryPanel'

import { I18nProvider } from '../../shared/i18n'
import type { ReactElement } from 'react'

const render = (ui: ReactElement) => { localStorage.setItem('kuchitoru.locale', 'ja'); return rtlRender(<I18nProvider>{ui}</I18nProvider>) }
const renderEnglish = (ui: ReactElement) => { localStorage.setItem('kuchitoru.locale', 'en'); return rtlRender(<I18nProvider>{ui}</I18nProvider>) }

const summary: MonthlySummary = {
  period_start: '2026-08-01',
  period_end: '2026-09-01',
  started: 12,
  completed: 9,
  completion_rate: 75,
  generation_succeeded: 8,
  google_handoffs: 6,
  average_rating: 4.5,
  previous_started: 7,
  started_change: 5,
  rating_distribution: { '5': 5, '4': 3, '3': 1 },
}

test('回答の流れと前月比較を意味のあるまとまりで表示する', () => {
  render(<MonthlySummaryPanel summary={summary} />)

  expect(screen.getByRole('region', { name: '2026年8月の月次サマリー' })).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '回答完了率' })).toHaveAttribute('aria-valuenow', '75')
  expect(screen.getByText('アンケート開始')).toBeVisible()
  expect(screen.getByText('Googleへ移動')).toBeVisible()
  expect(screen.getByText('前月比 +5件')).toBeVisible()
  expect(screen.getByText('開始数は前月の7件から5件増えました。今月は12件です。')).toBeVisible()
  expect(screen.queryByText('お客様の声の集まり方')).not.toBeInTheDocument()
  expect(screen.queryByText('アンケート開始からGoogle口コミへの移動までを、ひと続きで確認できます。')).not.toBeInTheDocument()
})

test('評価分布がない場合も誤解のない空状態を表示する', () => {
  render(<MonthlySummaryPanel summary={{ ...summary, average_rating: null, rating_distribution: {} }} />)

  expect(screen.getByText('評価データはまだありません')).toBeVisible()
  expect(screen.getByText('回答に評価が含まれると、ここに分布が表示されます。')).toBeVisible()
  expect(screen.getByLabelText('平均評価 未集計')).toBeVisible()
})

test('localizes dates, numbers, and singular response copy in English', () => {
  renderEnglish(<MonthlySummaryPanel summary={{ ...summary, started: 1, completed: 1, previous_started: 1, started_change: 0 }} />)
  expect(screen.getByRole('region', { name: 'Monthly summary for August 2026' })).toBeVisible()
  expect(screen.getByText('Starts were unchanged from last month at 1 response.')).toBeVisible()
  expect(screen.getByText('Survey starts')).toBeVisible()
})
