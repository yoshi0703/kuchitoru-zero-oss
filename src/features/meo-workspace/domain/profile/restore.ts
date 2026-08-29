import { diffProfileValues, type ProfileDifference } from './diff'
import { normalizeProfile } from './normalize'
import type { GbpLocationProfile, JsonValue, ProfileInput } from './types'

const READ_ONLY_ROOTS = new Set(['metadata', 'coordinates', 'providerFields'])
export interface RestoreOperation { readonly path: string; readonly action: 'set' | 'clear'; readonly value?: JsonValue }
export interface RestorePlan { readonly operations: readonly RestoreOperation[]; readonly excluded: readonly ProfileDifference[] }

export const createManualRestorePlan = (current: ProfileInput, target: ProfileInput): RestorePlan => {
  const currentValue = normalizeProfile(current) as unknown as JsonValue
  const targetValue = normalizeProfile(target) as unknown as JsonValue
  const changes = diffProfileValues(currentValue, targetValue)
  const excluded: ProfileDifference[] = []
  const operations: RestoreOperation[] = []
  for (const change of changes) {
    const root = change.path.split('/')[1] ?? ''
    if (READ_ONLY_ROOTS.has(root)) { excluded.push(change); continue }
    operations.push(change.kind === 'remove' ? { path: change.path, action: 'clear' } : { path: change.path, action: 'set', value: change.after })
  }
  return { operations, excluded }
}

export const restoreReadOnlyRoots = (): readonly (keyof GbpLocationProfile)[] => ['metadata', 'coordinates', 'providerFields']
