import { beforeEach, expect, test } from 'vitest'
import {
  clearMeoOauthCallbackFragment,
  clearMeoOauthProof,
  createMeoOauthProof,
  findMeoOauthProofByState,
  loadMeoOauthProof,
  parseMeoOauthCode,
  parseMeoOauthCallbackFragment,
  safeMeoAuthorizationRedirect,
  saveMeoOauthProof,
} from './meo-oauth-browser'

const STORE_ID = '44444444-4444-4444-8444-444444444444'
const STATE = 's'.repeat(43)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  window.sessionStorage.clear()
})

test('32-byte verifierとSHA-256 challengeをbase64url 43文字で生成する', async () => {
  const first = await createMeoOauthProof()
  const second = await createMeoOauthProof()
  const expectedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.verifier))
  const expectedChallenge = btoa(String.fromCharCode(...new Uint8Array(expectedDigest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')

  expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  expect(first.challenge).toBe(expectedChallenge)
  expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  expect(first.verifier).not.toBe(second.verifier)
  expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
})

test('verifierを店舗とprovider単位でsessionStorageに保存してstateから特定できる', () => {
  const proof = {
    storeId: STORE_ID,
    provider: 'instagram' as const,
    verifier: 'v'.repeat(43),
    expectedState: STATE,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    createdAt: Date.now(),
  }
  saveMeoOauthProof(proof)

  expect(loadMeoOauthProof(STORE_ID, 'instagram')).toEqual(proof)
  expect(findMeoOauthProofByState(STATE)).toEqual(proof)
  clearMeoOauthProof(STORE_ID, 'instagram')
  expect(loadMeoOauthProof(STORE_ID, 'instagram')).toBeNull()
})

test('10分を超えたverifierは利用せずsessionStorageから削除する', () => {
  const now = Date.now()
  saveMeoOauthProof({
    storeId: STORE_ID,
    provider: 'instagram',
    verifier: 'v'.repeat(43),
    expectedState: STATE,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    createdAt: now,
  })

  expect(loadMeoOauthProof(STORE_ID, 'instagram', window.sessionStorage, now + 10 * 60 * 1_000 + 1)).toBeNull()
  expect(window.sessionStorage).toHaveLength(0)
})

test('OAuth認可URLは公式HTTPS hostと有効なstateだけを許可する', () => {
  const google = safeMeoAuthorizationRedirect(
    'google_business',
    `https://accounts.google.com/o/oauth2/v2/auth?state=${STATE}`,
  )
  const instagram = safeMeoAuthorizationRedirect(
    'instagram',
    `https://www.instagram.com/oauth/authorize?state=${STATE}`,
  )

  expect(google.state).toBe(STATE)
  expect(instagram.state).toBe(STATE)
  expect(() => safeMeoAuthorizationRedirect(
    'google_business',
    `https://accounts.google.com.evil.example/oauth?state=${STATE}`,
  )).toThrow('接続先を確認できませんでした。')
  expect(() => safeMeoAuthorizationRedirect(
    'instagram',
    'https://www.instagram.com/oauth/authorize',
  )).toThrow('接続先を確認できませんでした。')
})

test('英語では認可先エラーを安全な英語で返す', () => {
  expect(() => safeMeoAuthorizationRedirect('google_business', `https://evil.example/?state=${STATE}`, 'en'))
    .toThrow('The connection destination could not be verified.')
})

test('callback codeは空値・制御文字・過大値を拒否する', () => {
  expect(parseMeoOauthCode('authorization-code')).toBe('authorization-code')
  expect(parseMeoOauthCode('')).toBeNull()
  expect(parseMeoOauthCode('bad\ncode')).toBeNull()
  expect(parseMeoOauthCode('x'.repeat(2_049))).toBeNull()
})

test('OAuth callbackはfragmentの厳密な4項目だけを解析する', () => {
  expect(parseMeoOauthCallbackFragment(
    `#connection=oauth_callback&provider=instagram&state=${STATE}&code=authorization-code`,
  )).toEqual({ provider: 'instagram', state: STATE, code: 'authorization-code' })
  expect(parseMeoOauthCallbackFragment(
    `#connection=oauth_callback&provider=instagram&state=${STATE}&code=authorization-code&extra=1`,
  )).toEqual({ provider: null, state: null, code: null })
  expect(parseMeoOauthCallbackFragment(
    `#connection=oauth_callback&provider=instagram&state=${STATE}&state=${STATE}&code=authorization-code`,
  )).toEqual({ provider: null, state: null, code: null })
  expect(parseMeoOauthCallbackFragment('?connection=oauth_callback')).toBeNull()
})

test('history.replaceStateでcallback fragmentだけを即時削除する', () => {
  window.history.replaceState(null, '', `/connections?keep=1#connection=oauth_callback&provider=instagram&state=${STATE}&code=authorization-code`)

  expect(clearMeoOauthCallbackFragment()).toBe(true)
  expect(window.location.pathname).toBe('/connections')
  expect(window.location.search).toBe('?keep=1')
  expect(window.location.hash).toBe('')
})
