import { describe, expect, it } from 'vitest'
import { safeReturnPath } from './safe-return-path'

const APP_ORIGIN = 'https://app.kuchitoru.example'

describe('safeReturnPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/dashboard/ai?from=oauth#connection', '/dashboard/ai?from=oauth#connection'],
    ['/account', '/account'],
    ['https://app.kuchitoru.example/dashboard/settings', '/dashboard/settings'],
  ])('allows a known same-origin destination: %s', (raw, expected) => {
    expect(safeReturnPath(raw, APP_ORIGIN)).toBe(expected)
  })

  it.each([
    [null],
    [''],
    ['//evil.example/steal'],
    ['https://evil.example/steal'],
    ['/\\evil.example/steal'],
    ['/%5Cevil.example/steal'],
    ['/dashboard/%5cevil.example'],
    ['/dashboard/%255Cevil.example'],
    ['/dashboard-impersonation'],
    ['/register'],
    ['/onboarding'],
    ['not-a-path'],
  ])('falls back from an unsafe or unknown destination: %s', (raw) => {
    expect(safeReturnPath(raw, APP_ORIGIN)).toBe('/dashboard')
  })
})
