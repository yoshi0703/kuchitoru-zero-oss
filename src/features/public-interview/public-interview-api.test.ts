import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SURVEY_CONFIG } from '../../shared/survey-config'

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }))

vi.mock('../../shared/api/http', () => ({ apiRequest: apiRequestMock }))

import { getPublicStore, resumeInterviewSession, rewriteReview, saveInterviewTurn, startInterviewSession } from './public-interview-api'

describe('public interview rewrite limits', () => {
  beforeEach(() => apiRequestMock.mockReset())

  it('accepts a session rewrite allowance up to the configured maximum', async () => {
    apiRequestMock.mockResolvedValue({
      review: '口コミ文',
      remainingRewrites: 17,
      generationSource: 'template',
    })

    await expect(rewriteReview({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionToken: 'a'.repeat(43),
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      locale: 'ja',
    })).resolves.toMatchObject({ remainingRewrites: 17 })
  })

  it('accepts a resumed session at the database maximum of twenty rewrites', async () => {
    apiRequestMock.mockResolvedValue({
      status: 'completed',
      turnCount: 0,
      maxTurns: 8,
      interviewComplete: true,
      generationStatus: 'succeeded',
      rewriteCount: 20,
      editedReview: '口コミ文',
      remainingRewrites: 0,
      next: { kind: 'review', review: '口コミ文' },
    })

    await expect(resumeInterviewSession({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionToken: 'a'.repeat(43),
    })).resolves.toMatchObject({ rewriteCount: 20, remainingRewrites: 0 })
  })

  it('rejects values above the session rewrite constraint', async () => {
    apiRequestMock.mockResolvedValue({
      review: '口コミ文',
      remainingRewrites: 21,
    })

    await expect(rewriteReview({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionToken: 'a'.repeat(43),
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      locale: 'ja',
    })).rejects.toThrow()
  })
})

describe('public survey snapshot contract', () => {
  beforeEach(() => apiRequestMock.mockReset())

  it('requires the public store revision', async () => {
    apiRequestMock.mockResolvedValue({
      publicSlug: 'test-store-123456',
      name: '店舗',
      surveyConfig: DEFAULT_SURVEY_CONFIG,
      surveyRevision: 1,
    })
    await expect(getPublicStore('test-store-123456')).resolves.toMatchObject({ surveyRevision: 1 })
  })

  it('keeps the exact survey snapshot returned by session start', async () => {
    apiRequestMock.mockResolvedValue({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionToken: 'a'.repeat(43),
      expiresAt: '2026-07-30T10:00:00.000Z',
      surveyConfig: DEFAULT_SURVEY_CONFIG,
      surveyRevision: 1,
    })
    await expect(startInterviewSession({
      publicSlug: 'test-store-123456',
      turnstileToken: 'token',
      locale: 'ja',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })).resolves.toMatchObject({ surveyConfig: DEFAULT_SURVEY_CONFIG, surveyRevision: 1 })
  })

  it('sends only the revision and typed answer map', async () => {
    apiRequestMock.mockResolvedValue({
      answerSaved: true,
      turnCount: 0,
      maxTurns: 8,
      next: { kind: 'ready_for_review' },
    })
    await saveInterviewTurn({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionToken: 'a'.repeat(43),
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      body: {
        kind: 'survey',
        surveyRevision: 1,
        answers: {
          q_000000000004: { type: 'short_text', value: 'ランチ' },
        },
      },
    })
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/public-interview/sessions/11111111-1111-4111-8111-111111111111/turns',
      expect.objectContaining({
        body: {
          kind: 'survey',
          surveyRevision: 1,
          answers: { q_000000000004: { type: 'short_text', value: 'ランチ' } },
        },
      }),
    )
  })
})

describe('generation language contract', () => {
  it('sends the frozen language when generating and rewriting', async () => {
    apiRequestMock.mockResolvedValue({ review: '日本語の原文', remainingRewrites: 2 })
    const credentials = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionToken: 'a'.repeat(43),
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      locale: 'en' as const,
    }
    const { generateReview } = await import('./public-interview-api')
    await generateReview(credentials)
    await rewriteReview(credentials)
    expect(apiRequestMock).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ body: { locale: 'en' } }))
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ body: { locale: 'en' } }))
  })
})
