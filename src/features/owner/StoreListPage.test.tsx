import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../shared/i18n'
import { beforeEach, expect, test, vi } from 'vitest'
import type * as OwnerApiModule from './owner-api'
import type { OwnerStoreListRecord, StoreRecord } from './owner-api'
import { StoreListPage } from './StoreListPage'

const apiMocks = vi.hoisted(() => ({
  createOwnerStore: vi.fn(),
  getOwnerStores: vi.fn(),
}))

vi.mock('./owner-api', async () => {
  const actual = await vi.importActual<typeof OwnerApiModule>('./owner-api')
  return { ...actual, ...apiMocks }
})

function store(
  id: string,
  name: string,
  status: StoreRecord['status'],
  isPubliclyAvailable = false,
): OwnerStoreListRecord {
  return {
    id,
    owner_store_slot: Number(id.at(-1)),
    public_slug: name,
    name,
    industry: null,
    address: null,
    description: null,
    website_url: null,
    welcome_message: null,
    closing_message: null,
    google_review_url: null,
    google_place_id: null,
    status,
    archived_at: null,
    is_publicly_available: isPubliclyAvailable,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <I18nProvider><QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StoreListPage />
      </MemoryRouter>
    </QueryClientProvider></I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('kuchitoru.locale', 'ja')
  vi.clearAllMocks()
  apiMocks.getOwnerStores.mockResolvedValue([])
  apiMocks.createOwnerStore.mockRejectedValue(new Error('response lost'))
})

test('同じ店舗作成の再送は同じ冪等性キーを使い、入力変更時だけ更新する', async () => {
  const user = userEvent.setup()
  renderPage()

  const addButtons = await screen.findAllByRole('button', { name: '店舗を追加' })
  const addButton = addButtons[0]
  expect(addButton).toBeDefined()
  if (!addButton) throw new Error('STORE_ADD_BUTTON_NOT_FOUND')
  await user.click(addButton)
  const nameInput = screen.getByRole('textbox', { name: '店舗名' })
  await user.type(nameInput, '店舗A')

  const submitButton = screen.getByRole('button', { name: '追加する' })
  await user.click(submitButton)
  await waitFor(() => expect(apiMocks.createOwnerStore).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(submitButton).toBeEnabled())
  const firstKey = apiMocks.createOwnerStore.mock.calls[0]?.[1]

  await user.click(submitButton)
  await waitFor(() => expect(apiMocks.createOwnerStore).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(submitButton).toBeEnabled())
  expect(apiMocks.createOwnerStore.mock.calls[1]?.[1]).toBe(firstKey)

  await user.type(nameInput, 'B')
  await user.click(submitButton)
  await waitFor(() => expect(apiMocks.createOwnerStore).toHaveBeenCalledTimes(3))
  expect(apiMocks.createOwnerStore.mock.calls[2]?.[1]).not.toBe(firstKey)
})

test('店舗の公開状態を表示する', async () => {
  const publishedId = '11111111-1111-4111-8111-111111111111'
  apiMocks.getOwnerStores.mockResolvedValue([
    store(publishedId, '公開店舗', 'published', true),
    store('33333333-3333-4333-8333-333333333333', '停止店舗', 'paused'),
  ])

  renderPage()

  expect(await screen.findByText('公開中')).toBeVisible()
  expect(screen.getByText('停止中')).toBeVisible()
})

test('共有店舗は権限を明示し、自店舗の登録上限とは別に扱う', async () => {
  apiMocks.getOwnerStores.mockResolvedValue([
    { ...store('11111111-1111-4111-8111-111111111111', '共有店', 'published', true), is_owned: false, access_role: 'editor' },
  ])
  renderPage()
  expect(await screen.findByText('共有店舗（editor）・公開中')).toBeVisible()
  expect(screen.getByText(/共有された店舗を管理できます/)).toBeVisible()
  expect(screen.getByRole('button', { name: '店舗を追加' })).toBeEnabled()
})

test('English store states never expose a Japanese upstream create error', async () => {
  localStorage.setItem('kuchitoru.locale', 'en')
  apiMocks.getOwnerStores.mockResolvedValue([store('11111111-1111-4111-8111-111111111111', 'Harbor Cafe', 'published', true)])
  apiMocks.createOwnerStore.mockRejectedValue(new Error('店舗を作成できません'))
  const user = userEvent.setup()
  const { container } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add store' }))
  await user.type(screen.getByRole('textbox', { name: 'Store name' }), 'Riverside Deli')
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(await screen.findByText('We couldn’t add the store.')).toBeVisible()
  expect(screen.queryByText('店舗を作成できません')).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent(/[぀-ヿ㐀-鿿]/u)
})
