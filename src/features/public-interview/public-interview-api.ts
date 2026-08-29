import { z } from 'zod'
import { apiRequest } from '../../shared/api/http'
import { SURVEY_CONFIG_SCHEMA, type SurveyQuestionType } from '../../shared/survey-config'
import type { Locale } from '../../shared/i18n'

const MAX_REWRITE_LIMIT = 20

const publicStoreSchema = z.object({
  publicSlug: z.string(),
  name: z.string(),
  industry: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  welcomeMessage: z.string().nullable().optional(),
  closingMessage: z.string().nullable().optional(),
  googleMapsUrl: z.string().url().nullable().optional(),
  surveyConfig: SURVEY_CONFIG_SCHEMA,
  surveyRevision: z.number().int().positive(),
})

const sessionSchema = z.object({
  sessionId: z.string().uuid(),
  sessionToken: z.string().min(16),
  expiresAt: z.string(),
  surveyConfig: SURVEY_CONFIG_SCHEMA,
  surveyRevision: z.number().int().positive(),
})

const turnSchema = z.object({
  answerSaved: z.literal(true),
  turnCount: z.number().int().min(0).max(8),
  maxTurns: z.literal(8),
  next: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('question'),
      message: z.object({ sequence: z.number().int().positive(), content: z.string() }),
    }),
    z.object({ kind: z.literal('ready_for_review') }),
  ]),
})

const reviewSchema = z.object({
  review: z.string().max(800),
  remainingRewrites: z.number().int().min(0).max(MAX_REWRITE_LIMIT),
  generationSource: z.enum(['ai', 'template']).optional(),
})
const handoffSchema = z.object({ recorded: z.boolean(), googleReviewUrl: z.string().url().optional() })
const resumeSchema = z.object({
  status: z.string(),
  turnCount: z.number().int().min(0).max(8),
  maxTurns: z.literal(8),
  interviewComplete: z.boolean(),
  generationStatus: z.string(),
  rewriteCount: z.number().int().min(0).max(MAX_REWRITE_LIMIT),
  editedReview: z.string().max(800).nullable(),
  remainingRewrites: z.number().int().min(0).max(MAX_REWRITE_LIMIT),
  surveyConfig: SURVEY_CONFIG_SCHEMA.optional(),
  surveyRevision: z.number().int().positive().optional(),
  next: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('profile') }),
    z.object({ kind: z.literal('conversation'), lastAssistantQuestion: z.string().nullable() }),
    z.object({ kind: z.literal('ready_for_review') }),
    z.object({ kind: z.literal('review'), review: z.string().max(800).nullable() }),
  ]),
})

export type PublicStore = z.infer<typeof publicStoreSchema>
export type InterviewSession = z.infer<typeof sessionSchema> & { locale: Locale }
export type InterviewTurnResult = z.infer<typeof turnSchema>
export type ReviewResult = z.infer<typeof reviewSchema>
export type ResumeResult = z.infer<typeof resumeSchema>

export async function getPublicStore(publicSlug: string): Promise<PublicStore> {
  const data = await apiRequest<unknown>(`/public-interview/stores/${encodeURIComponent(publicSlug)}`)
  return publicStoreSchema.parse(data)
}

export async function startInterviewSession(input: {
  publicSlug: string
  turnstileToken: string
  locale: Locale
  idempotencyKey: string
}): Promise<InterviewSession> {
  const data = await apiRequest<unknown>('/public-interview/sessions', {
    method: 'POST',
    body: { publicSlug: input.publicSlug, turnstileToken: input.turnstileToken, locale: input.locale },
    idempotencyKey: input.idempotencyKey,
  })
  return { ...sessionSchema.parse(data), locale: input.locale }
}

export async function resumeInterviewSession(input: {
  sessionId: string
  sessionToken: string
}): Promise<ResumeResult> {
  const data = await apiRequest<unknown>(`/public-interview/sessions/${input.sessionId}`, {
    interviewToken: input.sessionToken,
  })
  return resumeSchema.parse(data)
}

export async function saveInterviewTurn(input: {
  sessionId: string
  sessionToken: string
  body: {
    kind: 'survey'
    surveyRevision: number
    answers: Record<string, {
      type: SurveyQuestionType
      value: string | string[] | number
    }>
  }
  idempotencyKey: string
}): Promise<InterviewTurnResult> {
  const data = await apiRequest<unknown>(`/public-interview/sessions/${input.sessionId}/turns`, {
    method: 'POST',
    body: input.body,
    interviewToken: input.sessionToken,
    idempotencyKey: input.idempotencyKey,
  })
  return turnSchema.parse(data)
}

export async function generateReview(input: {
  sessionId: string
  sessionToken: string
  idempotencyKey: string
  locale: Locale
}): Promise<ReviewResult> {
  const data = await apiRequest<unknown>(`/public-interview/sessions/${input.sessionId}/review`, {
    method: 'POST',
    body: { locale: input.locale },
    interviewToken: input.sessionToken,
    idempotencyKey: input.idempotencyKey,
  })
  return reviewSchema.parse(data)
}

export async function saveReviewEdit(input: {
  sessionId: string
  sessionToken: string
  review: string
  idempotencyKey: string
}): Promise<ReviewResult> {
  const data = await apiRequest<unknown>(`/public-interview/sessions/${input.sessionId}/review`, {
    method: 'PATCH',
    body: { editedReview: input.review },
    interviewToken: input.sessionToken,
    idempotencyKey: input.idempotencyKey,
  })
  return reviewSchema.parse(data)
}

export async function rewriteReview(input: {
  sessionId: string
  sessionToken: string
  idempotencyKey: string
  locale: Locale
}): Promise<ReviewResult> {
  const data = await apiRequest<unknown>(`/public-interview/sessions/${input.sessionId}/rewrite`, {
    method: 'POST',
    body: { locale: input.locale },
    interviewToken: input.sessionToken,
    idempotencyKey: input.idempotencyKey,
  })
  return reviewSchema.parse(data)
}

export async function recordReviewHandoff(input: {
  sessionId: string
  sessionToken: string
  eventType: 'review_text_copied' | 'google_review_opened'
  editedReview: string
  idempotencyKey: string
}): Promise<{ recorded: boolean; googleReviewUrl?: string }> {
  const data = await apiRequest<unknown>(`/public-interview/sessions/${input.sessionId}/handoff`, {
    method: 'POST',
    body: { eventType: input.eventType, editedReview: input.editedReview },
    interviewToken: input.sessionToken,
    idempotencyKey: input.idempotencyKey,
  })
  const parsed = handoffSchema.parse(data)
  return parsed.googleReviewUrl === undefined
    ? { recorded: parsed.recorded }
    : { recorded: parsed.recorded, googleReviewUrl: parsed.googleReviewUrl }
}
