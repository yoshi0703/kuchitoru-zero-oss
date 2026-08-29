import { describe, expect, it } from 'vitest'
import {
  clearPasswordRecoveryMarker,
  e2ePasswordRecoveryIsExplicitlyEnabled,
  markPasswordRecoveryReady,
  passwordRecoveryMarkerIsFresh,
} from './password-recovery-state'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('password recovery state', () => {
  it('keeps a recovery marker only for the short same-tab window', () => {
    const storage = memoryStorage()
    markPasswordRecoveryReady(storage, 1_000)

    expect(passwordRecoveryMarkerIsFresh(storage, 1_000 + 14 * 60 * 1_000)).toBe(true)
    expect(passwordRecoveryMarkerIsFresh(storage, 1_000 + 16 * 60 * 1_000)).toBe(false)
  })

  it('clears the marker after recovery completes or the owner signs out', () => {
    const storage = memoryStorage()
    markPasswordRecoveryReady(storage, 1_000)
    clearPasswordRecoveryMarker(storage)

    expect(passwordRecoveryMarkerIsFresh(storage, 1_001)).toBe(false)
  })

  it('enables the browser smoke-test recovery state only with an explicit E2E signal', () => {
    expect(e2ePasswordRecoveryIsExplicitlyEnabled(true, '?e2ePasswordRecovery=1')).toBe(true)
    expect(e2ePasswordRecoveryIsExplicitlyEnabled(true, '')).toBe(false)
    expect(e2ePasswordRecoveryIsExplicitlyEnabled(false, '?e2ePasswordRecovery=1')).toBe(false)
  })
})
