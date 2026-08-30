import { describe, expect, it } from 'vitest'
import { isLegalTransition, transitionChangeRequest } from './approval'
import { planBulkChange } from './bulk'
import { exportStoreCsv, parseStoreCsv, STORE_CSV_VERSION } from './csv'
import { can, editDisposition, type Capability } from './policy'
import { compareStores, groupStores, rankStores } from './ranking'
import type { ChangeRequest, ChangeRequestState, Role, StoreSummary } from './types'

describe('role policy', () => {
  const actions: Capability[] = ['read', 'edit', 'manage-stores', 'manage-groups', 'manage-members', 'manage-invitations', 'review-changes', 'transfer-ownership']
  const expected: Record<Role, Capability[]> = {
    owner: actions,
    admin: actions.filter((action) => action !== 'transfer-ownership'),
    editor: ['read', 'edit'],
    analyst: ['read'],
  }
  for (const role of Object.keys(expected) as Role[]) for (const action of actions) {
    it(`${role} ${action}`, () => expect(can(role, action)).toBe(expected[role].includes(action)))
  }
  it('routes editor changes through approval but lets owners edit directly', () => {
    expect(editDisposition('editor', { mode: 'two-person' })).toBe('change-request')
    expect(editDisposition('owner', { mode: 'two-person' })).toBe('direct')
    expect(editDisposition('analyst', { mode: 'direct' })).toBe('denied')
  })
})

describe('approval transitions', () => {
  const states: ChangeRequestState[] = ['draft', 'pending', 'approved', 'rejected', 'cancelled', 'executed']
  const events = ['submit', 'approve', 'reject', 'cancel', 'execute'] as const
  const allowed = new Set(['draft:submit', 'draft:cancel', 'pending:approve', 'pending:reject', 'pending:cancel', 'approved:execute', 'approved:cancel'])
  for (const state of states) for (const event of events) {
    it(`${state} -> ${event}`, () => expect(isLegalTransition(state, event)).toBe(allowed.has(`${state}:${event}`)))
  }
  const pending: ChangeRequest = { id: 'c1', organizationId: 'o1', storeIds: ['s1'], proposerId: 'u1', payload: {}, state: 'pending' }
  it('denies self approval and editor review', () => {
    expect(() => transitionChangeRequest(pending, { type: 'approve', actorId: 'u1', actorRole: 'owner' })).toThrow(/own change/)
    expect(() => transitionChangeRequest(pending, { type: 'approve', actorId: 'u2', actorRole: 'editor' })).toThrow(/capability/)
  })
  it('records a valid independent approver', () => expect(transitionChangeRequest(pending, { type: 'approve', actorId: 'u2', actorRole: 'admin' })).toMatchObject({ state: 'approved', reviewerId: 'u2' }))
})

describe('store CSV', () => {
  it('round trips UTF-8, quotes and formula-like values safely', () => {
    const csv = exportStoreCsv([{ storeId: '=cmd', name: '東京,"店"', locationCode: '+1', groupId: '@group' }])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain("'=cmd")
    expect(csv).toContain("'+1")
    expect(csv).toContain("'@group")
    const parsed = parseStoreCsv(csv)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]).toEqual({ storeId: "'=cmd", name: '東京,"店"', locationCode: "'+1", groupId: "'@group" })
  })
  it('reports every validation error with stable physical data-row numbers', () => {
    const result = parseStoreCsv(`${STORE_CSV_VERSION}\nstore_id,name,location_code,group_id\ns1,,,\ns1,ok,x,\n,also,,`)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, column: 'name', code: 'required' }),
      expect.objectContaining({ row: 3, column: 'location_code', code: 'required' }),
      expect.objectContaining({ row: 4, column: 'store_id', code: 'duplicate_store_id' }),
      expect.objectContaining({ row: 5, column: 'store_id', code: 'required' }),
      expect.objectContaining({ row: 5, column: 'location_code', code: 'required' }),
    ]))
  })
  it('rejects malformed and wrong-schema files', () => {
    const result = parseStoreCsv('wrong\na,b\n"unclosed')
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['invalid_version', 'invalid_header', 'malformed_csv']))
  })
  it('localizes issues while preserving row metadata and mixed-language source cells', () => {
    const csv = `${STORE_CSV_VERSION}\nstore_id,name,location_code,group_id\ns1,東京 / Tokyo,,グループ A`
    const ja = parseStoreCsv(csv)
    const en = parseStoreCsv(csv, 'en')
    expect(en.rows).toEqual(ja.rows)
    expect(en.rows[0]).toEqual({ storeId: 's1', name: '東京 / Tokyo', locationCode: '', groupId: 'グループ A' })
    expect(en.errors.map(({ row, column, code }) => ({ row, column, code }))).toEqual(ja.errors.map(({ row, column, code }) => ({ row, column, code })))
    expect(ja.errors[0]?.message).toBe('location_codeは必須です')
    expect(en.errors[0]?.message).toBe('location_code is required')
  })
})

const stores: StoreSummary[] = [
  { id: 's2', organizationId: 'o', groupId: 'g1', name: 'B', locationCode: 'B' },
  { id: 's1', organizationId: 'o', groupId: 'g1', name: 'A', locationCode: 'A' },
  { id: 's3', organizationId: 'o', name: 'C', locationCode: 'C' },
]

describe('bulk planning and comparisons', () => {
  it('is deterministic and retains partial per-store errors in dry runs', () => {
    const plan = planBulkChange(stores, ['missing', 's2', 's1', 's2'], { field: 'name', value: 'A' })
    expect(plan.items.map((item) => item.storeId)).toEqual(['missing', 's1', 's2'])
    expect(plan.summary).toEqual({ total: 3, changes: 1, unchanged: 1, errors: 1 })
  })
  it('groups deterministically including ungrouped stores', () => {
    expect(groupStores(stores).get('g1')?.map((store) => store.id)).toEqual(['s1', 's2'])
    expect(groupStores(stores).get(null)?.map((store) => store.id)).toEqual(['s3'])
  })
  it('ranks ties and preserves missing data explicitly', () => {
    const metrics = [{ storeId: 's1', value: 4 }, { storeId: 's2', value: null }, { storeId: 's3', value: 4 }, { storeId: 's4', value: 2 }]
    expect(rankStores(metrics)).toEqual([
      { storeId: 's1', value: 4, rank: 1 }, { storeId: 's3', value: 4, rank: 1 },
      { storeId: 's4', value: 2, rank: 3 }, { storeId: 's2', value: null, rank: null },
    ])
    expect(compareStores(metrics).find((item) => item.storeId === 's2')?.differenceFromAverage).toBeNull()
  })
})
