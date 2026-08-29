import { createIdempotencyKey } from '../../shared/lib/idempotency'
import type { Locale } from '../../shared/i18n'
import type { MeoOauthProvider } from './meo-service-api'

const STORAGE_PREFIX = 'kuchitoru-zero:meo-oauth:v1:'
const STORE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64_URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PROOF_AGE_MS = 10 * 60 * 1_000

export type StoredMeoOauthProof = {
  storeId: string
  provider: MeoOauthProvider
  verifier: string
  expectedState: string
  idempotencyKey: string
  createdAt: number
}

export type MeoOauthCallbackFragment = {
  provider: MeoOauthProvider | null
  state: string | null
  code: string | null
}

function storageKey(storeId: string, provider: MeoOauthProvider): string {
  return `${STORAGE_PREFIX}${storeId}:${provider}`
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function validProvider(value: unknown): value is MeoOauthProvider {
  return value === 'google_business' || value === 'instagram'
}

function validProof(value: unknown, now: number): value is StoredMeoOauthProof {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false
  const proof = value as Record<string, unknown>
  return typeof proof.storeId === 'string'
    && STORE_ID_PATTERN.test(proof.storeId)
    && validProvider(proof.provider)
    && typeof proof.verifier === 'string'
    && BASE64_URL_256_PATTERN.test(proof.verifier)
    && typeof proof.expectedState === 'string'
    && BASE64_URL_256_PATTERN.test(proof.expectedState)
    && typeof proof.idempotencyKey === 'string'
    && IDEMPOTENCY_KEY_PATTERN.test(proof.idempotencyKey)
    && typeof proof.createdAt === 'number'
    && Number.isFinite(proof.createdAt)
    && proof.createdAt <= now + 60_000
    && now - proof.createdAt <= MAX_PROOF_AGE_MS
}

function readProofAtKey(key: string, storage: Storage, now: number): StoredMeoOauthProof | null {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (validProof(parsed, now)) return parsed
  } catch {
    // Corrupt browser state is never used as an OAuth secret.
  }
  try {
    storage.removeItem(key)
  } catch {
    // Unavailable storage is treated as no OAuth proof.
  }
  return null
}

export async function createMeoOauthProof(): Promise<{
  verifier: string
  challenge: string
  idempotencyKey: string
  createdAt: number
}> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return {
    verifier,
    challenge: base64Url(new Uint8Array(digest)),
    idempotencyKey: createIdempotencyKey(),
    createdAt: Date.now(),
  }
}

export function saveMeoOauthProof(
  proof: StoredMeoOauthProof,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage || !validProof(proof, Date.now())) throw new Error('外部サービスの接続確認を保存できませんでした。')
  try {
    storage.setItem(storageKey(proof.storeId, proof.provider), JSON.stringify(proof))
  } catch {
    throw new Error('外部サービスの接続確認を保存できませんでした。')
  }
}

export function loadMeoOauthProof(
  storeId: string,
  provider: MeoOauthProvider,
  storage: Storage | null = browserStorage(),
  now = Date.now(),
): StoredMeoOauthProof | null {
  if (!storage) return null
  const proof = readProofAtKey(storageKey(storeId, provider), storage, now)
  if (proof?.storeId !== storeId || proof.provider !== provider) return null
  return proof
}

export function findMeoOauthProofByState(
  expectedState: string,
  storage: Storage | null = browserStorage(),
  now = Date.now(),
): StoredMeoOauthProof | null {
  if (!storage || !BASE64_URL_256_PATTERN.test(expectedState)) return null
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    for (const key of keys) {
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      const proof = readProofAtKey(key, storage, now)
      if (proof?.expectedState === expectedState) return proof
    }
  } catch {
    return null
  }
  return null
}

export function clearMeoOauthProof(
  storeId: string,
  provider: MeoOauthProvider,
  storage: Storage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(storageKey(storeId, provider))
  } catch {
    // The absence of accessible storage already makes the callback fail closed.
  }
}

export function parseMeoOauthProvider(value: string | null): MeoOauthProvider | null {
  return validProvider(value) ? value : null
}

export function parseMeoOauthState(value: string | null): string | null {
  return value !== null && BASE64_URL_256_PATTERN.test(value) ? value : null
}

export function parseMeoOauthCode(value: string | null): string | null {
  return value !== null
      && value.length >= 1
      && value.length <= 2_048
      && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null
}

export function parseMeoOauthCallbackFragment(value: string): MeoOauthCallbackFragment | null {
  if (!value.startsWith('#')) return null
  const raw = value.slice(1)
  const params = new URLSearchParams(raw)
  if (!params.getAll('connection').includes('oauth_callback')) return null

  const allowedKeys = new Set(['connection', 'provider', 'state', 'code'])
  const hasExactShape = [...params.keys()].every((key) => allowedKeys.has(key))
    && params.getAll('connection').length === 1
    && params.getAll('provider').length === 1
    && params.getAll('state').length === 1
    && params.getAll('code').length === 1

  return {
    provider: hasExactShape ? parseMeoOauthProvider(params.get('provider')) : null,
    state: hasExactShape ? parseMeoOauthState(params.get('state')) : null,
    code: hasExactShape ? parseMeoOauthCode(params.get('code')) : null,
  }
}

export function clearMeoOauthCallbackFragment(): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
    return window.location.hash === ''
  } catch {
    return false
  }
}

export function safeMeoAuthorizationRedirect(
  provider: MeoOauthProvider,
  value: string,
  locale: Locale = 'ja',
): { url: string; state: string } {
  const url = new URL(value)
  const allowed = provider === 'google_business'
    ? url.protocol === 'https:' && url.hostname === 'accounts.google.com'
    : url.protocol === 'https:' && (url.hostname === 'www.instagram.com' || url.hostname === 'api.instagram.com')
  const state = parseMeoOauthState(url.searchParams.get('state'))
  if (!allowed || url.username || url.password || !state) {
    throw new Error(locale === 'ja' ? '接続先を確認できませんでした。' : 'The connection destination could not be verified.')
  }
  return { url: url.toString(), state }
}
