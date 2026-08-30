import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearInterviewSession, INTERVIEW_SESSION_TTL_MS, loadInterviewSession, saveInterviewSession } from './interview-session-storage'
import { DEFAULT_SURVEY_CONFIG } from '../survey-config'

describe('same-tab interview session storage', () => {
  beforeEach(() => sessionStorage.clear())

  const record = () => ({
    publicSlug: 'store',
    sessionId: 'session',
    sessionToken: 'secret-token',
    expiresAt: new Date(Date.now() + INTERVIEW_SESSION_TTL_MS).toISOString(),
    surveyConfig: DEFAULT_SURVEY_CONFIG,
    surveyRevision: 1,
    locale: 'ja' as const,
  })

  it('stores and restores only the resume credentials allowlist', () => {
    const expected = record()
    saveInterviewSession({
      ...expected,
      surveyAnswers: { q_000000000001: '氏名を含む回答' },
      unsentDraft: '未送信の個人情報',
      email: 'visitor@example.com',
      phone: '090-0000-0000',
    } as Parameters<typeof saveInterviewSession>[0])

    const serialized = sessionStorage.getItem('kuchitoru:interview-session:store') ?? ''
    expect(JSON.parse(serialized)).toEqual({ version: 2, ...expected })
    expect(serialized).not.toContain('surveyAnswers')
    expect(serialized).not.toContain('unsentDraft')
    expect(serialized).not.toContain('visitor@example.com')
  })

  it('bounds browser persistence to the same fifteen-minute server TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
    saveInterviewSession({ ...record(), expiresAt: '2026-07-10T01:00:00Z' })
    expect(loadInterviewSession('store')?.expiresAt).toBe('2026-07-10T00:15:00.000Z')
    vi.setSystemTime(new Date('2026-07-10T00:15:00.001Z'))
    expect(loadInterviewSession('store')).toBeNull()
    vi.useRealTimers()
  })

  it.each([
    ['legacy data', JSON.stringify({ ...record(), unsentDraft: '' })],
    ['unexpected fields', JSON.stringify({ version: 1, ...record(), pii: 'secret' })],
    ['invalid JSON', '{'],
  ])('deletes %s instead of attempting a compatibility restore', (_label, value) => {
    sessionStorage.setItem('kuchitoru:interview-session:store', value)
    expect(loadInterviewSession('store')).toBeNull()
    expect(sessionStorage.getItem('kuchitoru:interview-session:store')).toBeNull()
  })

  it('can be explicitly cleared', () => {
    saveInterviewSession(record())
    clearInterviewSession('store')
    expect(loadInterviewSession('store')).toBeNull()
  })
})

describe('session language compatibility', () => {
  it('restores version 1 sessions as Japanese without rewriting source content', () => {
    const legacy = {
      version: 1,
      publicSlug: 'legacy',
      sessionId: 'session',
      sessionToken: 'secret-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      surveyConfig: DEFAULT_SURVEY_CONFIG,
      surveyRevision: 1,
    }
    sessionStorage.setItem('kuchitoru:interview-session:legacy', JSON.stringify(legacy))
    const restored = loadInterviewSession('legacy')
    expect(restored?.locale).toBe('ja')
    expect(restored?.surveyConfig).toEqual(DEFAULT_SURVEY_CONFIG)
  })

  it('freezes English in the version 2 session record', () => {
    const english = { publicSlug: 'store', sessionId: 'session', sessionToken: 'secret-token', expiresAt: new Date(Date.now() + 60_000).toISOString(), surveyConfig: DEFAULT_SURVEY_CONFIG, surveyRevision: 1, locale: 'en' as const }
    saveInterviewSession(english)
    expect(loadInterviewSession('store')).toMatchObject({ locale: 'en', surveyConfig: DEFAULT_SURVEY_CONFIG })
  })
})
