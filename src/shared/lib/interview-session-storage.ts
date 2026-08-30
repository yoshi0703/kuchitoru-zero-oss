import { SURVEY_CONFIG_SCHEMA, type SurveyConfigV3 } from '../survey-config'
import { parseLocale, type Locale } from '../i18n'

export const INTERVIEW_SESSION_TTL_MS = 15 * 60 * 1000

export type StoredInterviewSession = {
  publicSlug: string
  sessionId: string
  sessionToken: string
  expiresAt: string
  surveyConfig: SurveyConfigV3
  surveyRevision: number
  locale: Locale
}

type SerializedInterviewSession = StoredInterviewSession & { version: 2 }
type LegacySerializedInterviewSession = Omit<StoredInterviewSession, 'locale'> & { version: 1 }

const KEY_PREFIX = 'kuchitoru:interview-session:'
const SERIALIZED_KEYS = [
  'version',
  'publicSlug',
  'sessionId',
  'sessionToken',
  'expiresAt',
  'surveyConfig',
  'surveyRevision',
  'locale',
] as const
const keyFor = (publicSlug: string) => `${KEY_PREFIX}${publicSlug}`

export function saveInterviewSession(session: StoredInterviewSession): void {
  const expiresAt = new Date(session.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    clearInterviewSession(session.publicSlug)
    return
  }

  const record: SerializedInterviewSession = {
    version: 2,
    publicSlug: session.publicSlug,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    expiresAt: new Date(Math.min(expiresAt, Date.now() + INTERVIEW_SESSION_TTL_MS)).toISOString(),
    surveyConfig: session.surveyConfig,
    surveyRevision: session.surveyRevision,
    locale: session.locale,
  }
  sessionStorage.setItem(keyFor(session.publicSlug), JSON.stringify(record))
}

export function loadInterviewSession(publicSlug: string): StoredInterviewSession | null {
  const raw = sessionStorage.getItem(keyFor(publicSlug))
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    const normalized = normalizeSerializedInterviewSession(parsed, publicSlug)
    if (!normalized) {
      clearInterviewSession(publicSlug)
      return null
    }
    return {
      publicSlug: normalized.publicSlug,
      sessionId: normalized.sessionId,
      sessionToken: normalized.sessionToken,
      expiresAt: normalized.expiresAt,
      surveyConfig: normalized.surveyConfig,
      surveyRevision: normalized.surveyRevision,
      locale: normalized.locale,
    }
  } catch {
    clearInterviewSession(publicSlug)
    return null
  }
}

function normalizeSerializedInterviewSession(
  value: unknown,
  publicSlug: string,
): SerializedInterviewSession | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = value as Record<string, unknown>
  const keys = Object.keys(parsed)
  const legacyKeys = SERIALIZED_KEYS.filter((key) => key !== 'locale')
  const expectedKeys = parsed.version === 1 ? legacyKeys : SERIALIZED_KEYS
  const valid = (
    keys.length === expectedKeys.length &&
    keys.every((key) => (expectedKeys as readonly string[]).includes(key)) &&
    (parsed.version === 1 || parsed.version === 2) &&
    parsed.publicSlug === publicSlug &&
    typeof parsed.sessionId === 'string' &&
    typeof parsed.sessionToken === 'string' &&
    typeof parsed.expiresAt === 'string' &&
    Number.isInteger(parsed.surveyRevision) &&
    (parsed.surveyRevision as number) >= 1 &&
    SURVEY_CONFIG_SCHEMA.safeParse(parsed.surveyConfig).success &&
    Number.isFinite(new Date(parsed.expiresAt).getTime()) &&
    new Date(parsed.expiresAt).getTime() > Date.now()
  )
  if (!valid) return null
  const legacy = parsed as unknown as LegacySerializedInterviewSession
  const locale = parsed.version === 1 ? 'ja' : parseLocale(parsed.locale)
  if (!locale) return null
  return { ...legacy, version: 2, locale }
}

export function clearInterviewSession(publicSlug: string): void {
  sessionStorage.removeItem(keyFor(publicSlug))
}
