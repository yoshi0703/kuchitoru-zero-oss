import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MeoWorkspaceDataTable,
  MeoWorkspaceEmptyState,
  MeoWorkspaceErrorState,
  MeoWorkspaceFilterRow,
  MeoWorkspaceFormGrid,
  MeoWorkspacePage,
  MeoWorkspacePermissionNotice,
  MeoWorkspaceSection,
  MeoWorkspaceStatus,
  MeoWorkspaceTabs,
} from './MeoWorkspace'
import { isMeoWorkspaceReadOnly } from './permissions'

const i18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))
vi.mock('../../../shared/i18n', () => ({
  useI18n: () => ({
    locale: i18n.locale,
    text: (copy: Record<'ja' | 'en', string>) => copy[i18n.locale],
    formatNumber: (value: number) => new Intl.NumberFormat(i18n.locale === 'ja' ? 'ja-JP' : 'en-US').format(value),
  }),
}))

describe('MeoWorkspace common shell', () => {
  afterEach(() => { i18n.locale = 'ja' })
  it('puts the page header and every page surface on the same container start line', () => {
    const { container } = render(
      <MeoWorkspacePage
        title="GBP情報管理"
        description="店舗情報を管理します。"
        actions={<button type="button">変更を保存</button>}
      >
        <MeoWorkspaceSection title="基本情報">
          <MeoWorkspaceFormGrid><label>店舗名<input /></label></MeoWorkspaceFormGrid>
        </MeoWorkspaceSection>
        <MeoWorkspaceFilterRow><label>状態<select><option>すべて</option></select></label></MeoWorkspaceFilterRow>
      </MeoWorkspacePage>,
    )

    const page = container.querySelector('[data-meo-workspace-container="true"]')
    expect(page).toHaveClass('meo-workspace-page')
    expect(page?.querySelector(':scope > .meo-workspace-header')).toHaveAttribute('data-meo-workspace-align', 'start')
    expect(page?.querySelector(':scope > .meo-workspace-header .meo-workspace-actions')).toHaveAttribute('data-meo-workspace-align', 'start')
    expect(page?.querySelector(':scope > .meo-workspace-section')).toHaveAttribute('data-meo-workspace-align', 'start')
    expect(page?.querySelector(':scope > .meo-workspace-filter-row')).toHaveAttribute('data-meo-workspace-align', 'start')
    expect(screen.getByRole('heading', { level: 1, name: 'GBP情報管理' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: '基本情報' })).toBeVisible()
  })

  it('exposes semantic tabs, filters, status and mobile table labels', () => {
    const onTabChange = vi.fn()
    render(
      <>
        <MeoWorkspaceTabs
          label="口コミの状態"
          value="all"
          items={[
            { value: 'all', label: 'すべて', count: 3 },
            { value: 'pending', label: '未返信', count: 2 },
          ]}
          onValueChange={onTabChange}
        />
        <MeoWorkspaceFilterRow label="口コミを絞り込む">
          <label>キーワード<input /></label>
        </MeoWorkspaceFilterRow>
        <MeoWorkspaceStatus label="同期済み" detail="5分前" tone="success" />
        <MeoWorkspaceDataTable<{ name: string; rating: number }>
          label="口コミ一覧"
          columns={[
            { id: 'name', header: '投稿者', cell: (row: { name: string }) => row.name },
            { id: 'rating', header: '評価', mobileLabel: '星評価', cell: (row) => row.rating },
          ]}
          rows={[{ name: '山田さん', rating: 5 }]}
          getRowKey={(row) => row.name}
        />
      </>,
    )

    const tabs = screen.getByRole('tablist', { name: '口コミの状態' })
    expect(within(tabs).getByRole('tab', { name: /すべて/u })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(tabs).getByRole('tab', { name: /未返信/u }))
    expect(onTabChange).toHaveBeenCalledWith('pending')
    expect(screen.getByRole('search', { name: '口コミを絞り込む' })).toBeVisible()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('同期済み5分前')
    expect(screen.getByRole('table', { name: '口コミ一覧' })).toBeVisible()
    expect(screen.getByText('5').closest('td')).toHaveAttribute('data-label', '星評価')
  })

  it('makes Analyst explicitly read-only while editable roles stay unobtrusive', () => {
    const { rerender } = render(<MeoWorkspacePermissionNotice role="analyst" />)

    expect(screen.getByRole('complementary', { name: 'この画面の操作権限' })).toHaveTextContent('閲覧専用')
    expect(screen.getByText(/編集・公開・復元はできません/u)).toBeVisible()
    expect(isMeoWorkspaceReadOnly('analyst')).toBe(true)
    expect(isMeoWorkspaceReadOnly('editor')).toBe(false)

    rerender(<MeoWorkspacePermissionNotice role="editor" />)
    expect(screen.queryByRole('complementary', { name: 'この画面の操作権限' })).not.toBeInTheDocument()
  })

  it('announces errors and keeps retry and empty-state actions operable', () => {
    const retry = vi.fn()
    render(
      <>
        <MeoWorkspaceErrorState title="読み込めませんでした" onRetry={retry} />
        <MeoWorkspaceEmptyState title="データがありません" action={<button type="button">追加する</button>} />
      </>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした')
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '追加する' })).toBeEnabled()
  })

  it('localizes generic defaults and accessibility copy without changing source content', () => {
    i18n.locale = 'en'
    render(
      <MeoWorkspacePage title="Source title" description={<span>Source description</span>}>
        <MeoWorkspaceTabs value="all" items={[{ value: 'all', label: 'Source tab', count: 1200 }]} onValueChange={() => undefined} />
        <MeoWorkspaceFilterRow><span>Source filter</span></MeoWorkspaceFilterRow>
        <MeoWorkspacePermissionNotice role="analyst" />
        <MeoWorkspaceErrorState title="Unknown source error" onRetry={() => undefined} />
      </MeoWorkspacePage>,
    )

    expect(screen.getByText('Source description')).toBeVisible()
    expect(screen.getByRole('tablist', { name: 'Content view' })).toBeVisible()
    expect(screen.getByLabelText('1,200 items')).toHaveTextContent('1,200')
    expect(screen.getByRole('search', { name: 'Filters' })).toHaveTextContent('Source filter')
    expect(screen.getByRole('complementary', { name: 'Permissions for this page' })).toHaveTextContent('Read only')
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown source error')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
})
