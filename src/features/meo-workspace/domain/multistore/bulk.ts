import type { StoreId, StoreSummary } from './types'

export interface BulkChange { field: 'name' | 'locationCode' | 'groupId'; value: string | undefined }
export interface BulkPlanItem { storeId: StoreId; before: string | undefined; after: string | undefined; status: 'change' | 'unchanged' | 'error'; error?: string }
export interface BulkPlan { items: readonly BulkPlanItem[]; summary: { total: number; changes: number; unchanged: number; errors: number } }

export function planBulkChange(stores: readonly StoreSummary[], selectedStoreIds: readonly StoreId[], change: BulkChange): BulkPlan {
  const byId = new Map(stores.map((store) => [store.id, store]))
  const items = [...new Set(selectedStoreIds)].sort().map((storeId): BulkPlanItem => {
    const store = byId.get(storeId)
    if (!store) return { storeId, before: undefined, after: change.value, status: 'error', error: 'store_not_found' }
    const before = store[change.field]
    if (change.field !== 'groupId' && (!change.value || !change.value.trim())) return { storeId, before, after: change.value, status: 'error', error: 'value_required' }
    return { storeId, before, after: change.value, status: before === change.value ? 'unchanged' : 'change' }
  })
  return { items, summary: { total: items.length, changes: items.filter((item) => item.status === 'change').length, unchanged: items.filter((item) => item.status === 'unchanged').length, errors: items.filter((item) => item.status === 'error').length } }
}
