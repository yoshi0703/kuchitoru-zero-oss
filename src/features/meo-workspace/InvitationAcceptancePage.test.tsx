import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, test, vi } from 'vitest'
import { InvitationAcceptancePage } from './InvitationAcceptancePage'

const api = vi.hoisted(() => ({ accept: vi.fn() }))
const i18n = vi.hoisted(() => ({ locale: 'ja' as 'ja' | 'en' }))
vi.mock('./meo-workspace-api', () => ({ acceptMeoWorkspaceInvitation: api.accept }))
vi.mock('../../shared/i18n', () => ({ useI18n: () => ({ text: (copy: Record<'ja' | 'en', string>) => copy[i18n.locale] }) }))

test('招待トークンを検証し、受諾後に共有店舗のMEO管理へ移動する', async () => {
  const token = 'a'.repeat(43)
  api.accept.mockResolvedValue({
    organizationId: '33333333-3333-4333-8333-333333333333',
    storeId: '22222222-2222-4222-8222-222222222222',
    role: 'editor',
  })
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/dashboard/invitations/accept?token=${token}`]}>
        <Routes>
          <Route path="/dashboard/invitations/accept" element={<InvitationAcceptancePage />} />
          <Route path="/dashboard/stores/:storeId/meo/workspace/profile" element={<h1>共有店舗MEO</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByLabelText('招待トークン')).toHaveValue(token)
  fireEvent.click(screen.getByRole('button', { name: '招待を受諾' }))
  await waitFor(() => expect(api.accept).toHaveBeenCalledWith(token, expect.anything()))
  expect(await screen.findByRole('heading', { name: '共有店舗MEO' })).toBeVisible()
})

test('shows safe English invitation copy while preserving token validation', async () => {
  i18n.locale = 'en'
  api.accept.mockRejectedValue(new Error('内部の日本語エラー'))
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard/invitations/accept?token=invalid']}>
        <InvitationAcceptancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  expect(screen.getByRole('heading', { name: 'Accept an MEO workspace invitation' })).toBeVisible()
  const input = screen.getByLabelText('Invitation token')
  expect(input).toHaveValue('')
  fireEvent.change(input, { target: { value: 'a'.repeat(43) } })
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText('This invitation is invalid, expired, already used, or does not match your signed-in email address.')).toBeVisible()
  expect(screen.queryByText('内部の日本語エラー')).not.toBeInTheDocument()
})
