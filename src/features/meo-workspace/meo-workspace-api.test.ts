import { beforeEach, expect, test, vi } from 'vitest'
import type * as HttpModule from '../../shared/api/http'
import { apiRequest } from '../../shared/api/http'
import {
  __test,
  acceptMeoWorkspaceInvitation,
  getMeoWorkspaceAccessibleStores,
  getMeoWorkspaceSnapshot,
  listMeoWorkspaceResource,
  mutateMeoWorkspaceResource,
} from './meo-workspace-api'

vi.mock('../../shared/api/http', async () => {
  const actual = await vi.importActual<typeof HttpModule>('../../shared/api/http')
  return { ...actual, apiRequest: vi.fn() }
})

const request = vi.mocked(apiRequest)
const storeId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'

beforeEach(() => request.mockReset())

test('workspace snapshot validates the tenant and normalizes snake case', async () => {
  request.mockResolvedValue({
    authorization: {
      organization_id: organizationId,
      store_id: storeId,
      role: 'editor',
      approval_required: true,
    },
    organization: { name: '東日本' },
    store: { google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
    profile: null,
    counts: { reviews: 12, posts: 3 },
    generated_at: '2026-08-13T00:00:00.000Z',
  })

  await expect(getMeoWorkspaceSnapshot(storeId)).resolves.toMatchObject({
    authorization: { organizationId, storeId, role: 'editor', approvalRequired: true },
    store: { google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
    counts: { reviews: 12, posts: 3 },
  })
  expect(request).toHaveBeenCalledWith(`/meo-workspace/v1/stores/${storeId}/snapshot`, {
    ownerAuth: true,
  })
})

test('workspace snapshot rejects a different store id', () => {
  expect(() => __test.parseSnapshot({
    authorization: {
      organization_id: organizationId,
      store_id: '44444444-4444-4444-8444-444444444444',
      role: 'owner',
      approval_required: false,
    },
  }, storeId)).toThrow('MEO管理データを正しく読み込めませんでした。')
})

test('list uses a stable encoded query and parses a cursor page', async () => {
  request.mockResolvedValue({ items: [{ id: 'one' }], next_cursor: 'next/one' })
  await expect(listMeoWorkspaceResource<{ id: string }>(storeId, 'reviews', {
    limit: 25,
    cursor: 'cursor/zero',
    filters: { status: 'needs_reply', rating: 2, search: undefined },
  })).resolves.toEqual({ items: [{ id: 'one' }], nextCursor: 'next/one' })
  expect(request).toHaveBeenCalledWith(
    `/meo-workspace/v1/stores/${storeId}/resources/reviews?cursor=cursor%2Fzero&limit=25&rating=2&status=needs_reply`,
    { ownerAuth: true },
  )
})

test('mutation keeps explicit approval state', async () => {
  request.mockResolvedValue({
    approval_required: true,
    change_request_id: '55555555-5555-4555-8555-555555555555',
    data: { status: 'pending' },
  })
  await expect(mutateMeoWorkspaceResource(
    storeId,
    'profile',
    'save',
    { businessName: 'クチトル食堂' },
  )).resolves.toMatchObject({ approvalRequired: true, data: { status: 'pending' } })
})

test('member invitation unwraps the stored row and one-time token', async () => {
  request.mockResolvedValue({
    result: { id: '55555555-5555-4555-8555-555555555555', email: 'editor@example.test' },
    invitation: { token: 'one-time-token', expiresAt: '2026-08-20T00:00:00.000Z' },
  })
  await expect(mutateMeoWorkspaceResource<Record<string, unknown>>(
    storeId,
    'members',
    'create',
    { email: 'editor@example.test', role: 'editor' },
  )).resolves.toMatchObject({
    data: { email: 'editor@example.test', invitation: { token: 'one-time-token' } },
    approvalRequired: false,
  })
})

test('accessible stores use the workspace access endpoint', async () => {
  request.mockResolvedValue([{ id: storeId, name: '共有店舗' }])
  await expect(getMeoWorkspaceAccessibleStores()).resolves.toEqual([{ id: storeId, name: '共有店舗' }])
  expect(request).toHaveBeenCalledWith('/meo-workspace/v1/stores', { ownerAuth: true })
})

test('invitation acceptance validates and normalizes the RPC readback', async () => {
  request.mockResolvedValue({ organization_id: organizationId, store_id: storeId, role: 'analyst' })
  await expect(acceptMeoWorkspaceInvitation('a'.repeat(43))).resolves.toEqual({
    organizationId, storeId, role: 'analyst',
  })
  expect(request).toHaveBeenCalledWith('/meo-workspace/v1/invitations/accept', {
    method: 'POST', ownerAuth: true, body: { token: 'a'.repeat(43) },
  })
})
