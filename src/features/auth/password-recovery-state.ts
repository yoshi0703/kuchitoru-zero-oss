const PASSWORD_RECOVERY_MARKER_KEY = 'kuchitoru.password-recovery-ready'
const PASSWORD_RECOVERY_MARKER_MAX_AGE_MS = 15 * 60 * 1000

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function sessionStorageIfAvailable(): RecoveryStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function passwordRecoveryMarkerIsFresh(
  storage: RecoveryStorage | null = sessionStorageIfAvailable(),
  now = Date.now(),
): boolean {
  if (storage === null) return false

  try {
    const startedAt = Number(storage.getItem(PASSWORD_RECOVERY_MARKER_KEY))
    const isFresh = Number.isFinite(startedAt)
      && startedAt > 0
      && now >= startedAt
      && now - startedAt <= PASSWORD_RECOVERY_MARKER_MAX_AGE_MS

    if (!isFresh) storage.removeItem(PASSWORD_RECOVERY_MARKER_KEY)
    return isFresh
  } catch {
    return false
  }
}

export function markPasswordRecoveryReady(
  storage: RecoveryStorage | null = sessionStorageIfAvailable(),
  now = Date.now(),
): void {
  if (storage === null) return
  try {
    storage.setItem(PASSWORD_RECOVERY_MARKER_KEY, String(now))
  } catch {
    // Recovery remains usable for the current render even when storage is unavailable.
  }
}

export function clearPasswordRecoveryMarker(
  storage: RecoveryStorage | null = sessionStorageIfAvailable(),
): void {
  if (storage === null) return
  try {
    storage.removeItem(PASSWORD_RECOVERY_MARKER_KEY)
  } catch {
    // Storage cleanup is best-effort. The marker also expires after a short window.
  }
}

export function e2ePasswordRecoveryIsExplicitlyEnabled(
  isE2ETestMode: boolean,
  search = typeof window === 'undefined' ? '' : window.location.search,
): boolean {
  return isE2ETestMode && new URLSearchParams(search).get('e2ePasswordRecovery') === '1'
}
