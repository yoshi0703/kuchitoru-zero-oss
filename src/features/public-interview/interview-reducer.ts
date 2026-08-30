import { getPublicInterviewCopy } from './copy'
import type { InterviewSession, PublicStore, ResumeResult } from './public-interview-api'

export type InterviewMessage = { id: string; role: 'assistant' | 'user'; content: string }
export type PendingTurn = { content: string; idempotencyKey: string }

export type InterviewState =
  | { phase: 'loading-store' }
  | { phase: 'unavailable'; message: string }
  | { phase: 'welcome'; store: PublicStore; error: string }
  | { phase: 'resume-offer'; store: PublicStore; session: InterviewSession; draft: string; busy: boolean; error: string }
  | { phase: 'starting'; store: PublicStore }
  | { phase: 'profile'; store: PublicStore; session: InterviewSession; busy: boolean; error: string }
  | {
      phase: 'conversation'
      store: PublicStore
      session: InterviewSession
      messages: InterviewMessage[]
      draft: string
      turnCount: number
      status: 'idle' | 'submitting' | 'retryable-error'
      answerSaved: boolean
      error: string
      pendingTurn: PendingTurn | null
    }
  | { phase: 'review-generating'; store: PublicStore; session: InterviewSession; messages: InterviewMessage[]; status: 'loading' | 'error'; error: string }
  | {
      phase: 'review-editing'
      store: PublicStore
      session: InterviewSession
      review: string
      remainingRewrites: number
      status: 'idle' | 'saving' | 'copying' | 'rewriting' | 'handoff'
      message: string
      error: string
    }
  | { phase: 'completed'; store: PublicStore; closingMessage: string }

export type InterviewAction =
  | { type: 'STORE_READY'; store: PublicStore }
  | { type: 'STORE_FAILED'; message: string }
  | { type: 'STARTING' }
  | { type: 'SESSION_STARTED'; session: InterviewSession }
  | { type: 'SESSION_FOUND'; store: PublicStore; session: InterviewSession; draft: string }
  | { type: 'RESUME_BUSY'; busy: boolean; error?: string }
  | { type: 'SESSION_RESUMED'; result: ResumeResult }
  | { type: 'START_FAILED'; message: string }
  | { type: 'PROFILE_BUSY'; busy: boolean; error?: string }
  | { type: 'QUESTION_READY'; message: string; turnCount: number; answerSaved: boolean }
  | { type: 'DRAFT_CHANGED'; draft: string }
  | { type: 'TURN_SUBMITTING'; pendingTurn: PendingTurn }
  | { type: 'TURN_FAILED'; message: string; answerSaved: boolean }
  | { type: 'REVIEW_GENERATING' }
  | { type: 'REVIEW_FAILED'; message: string }
  | { type: 'REVIEW_READY'; review: string; remainingRewrites: number }
  | { type: 'REVIEW_CHANGED'; review: string }
  | { type: 'REVIEW_STATUS'; status: 'idle' | 'saving' | 'copying' | 'rewriting' | 'handoff'; message?: string; error?: string }
  | { type: 'COMPLETED' }

export const initialInterviewState: InterviewState = { phase: 'loading-store' }

export function interviewReducer(state: InterviewState, action: InterviewAction): InterviewState {
  switch (action.type) {
    case 'STORE_READY':
      return { phase: 'welcome', store: action.store, error: '' }
    case 'STORE_FAILED':
      return { phase: 'unavailable', message: action.message }
    case 'STARTING':
      return state.phase === 'welcome' ? { phase: 'starting', store: state.store } : state
    case 'SESSION_STARTED':
      return state.phase === 'starting'
        ? { phase: 'profile', store: state.store, session: action.session, busy: false, error: '' }
        : state
    case 'SESSION_FOUND':
      return { phase: 'resume-offer', store: action.store, session: action.session, draft: action.draft, busy: false, error: '' }
    case 'RESUME_BUSY':
      return state.phase === 'resume-offer' ? { ...state, busy: action.busy, error: action.error ?? '' } : state
    case 'SESSION_RESUMED': {
      if (state.phase !== 'resume-offer') return state
      const session = action.result.surveyConfig && action.result.surveyRevision
        ? {
            ...state.session,
            surveyConfig: action.result.surveyConfig,
            surveyRevision: action.result.surveyRevision,
          }
        : state.session
      if (action.result.next.kind === 'profile') {
        return { phase: 'profile', store: state.store, session, busy: false, error: '' }
      }
      if (action.result.next.kind === 'review') {
        return {
          phase: 'review-editing', store: state.store, session,
          review: action.result.next.review ?? action.result.editedReview ?? '',
          remainingRewrites: action.result.remainingRewrites, status: 'idle', message: '', error: '',
        }
      }
      if (action.result.next.kind === 'ready_for_review') {
        return {
          phase: 'review-generating', store: state.store, session, messages: [],
          status: 'error', error: getPublicInterviewCopy(session.locale).resumeGeneration,
        }
      }
      if (action.result.next.kind === 'conversation') {
        return { phase: 'profile', store: state.store, session, busy: false, error: '' }
      }
      return state
    }
    case 'START_FAILED':
      return state.phase === 'starting' ? { phase: 'welcome', store: state.store, error: action.message } : state
    case 'PROFILE_BUSY':
      return state.phase === 'profile' ? { ...state, busy: action.busy, error: action.error ?? '' } : state
    case 'QUESTION_READY': {
      if (state.phase !== 'profile' && state.phase !== 'conversation') return state
      const messages = state.phase === 'conversation' ? state.messages : []
      return {
        phase: 'conversation', store: state.store, session: state.session,
        messages: [...messages, { id: `assistant-${messages.length}`, role: 'assistant', content: action.message }],
        draft: '', turnCount: action.turnCount, status: 'idle', answerSaved: action.answerSaved, error: '', pendingTurn: null,
      }
    }
    case 'DRAFT_CHANGED':
      return state.phase === 'conversation' ? { ...state, draft: action.draft } : state
    case 'TURN_SUBMITTING':
      return state.phase === 'conversation'
        ? {
            ...state, status: 'submitting', answerSaved: false, error: '', pendingTurn: action.pendingTurn, draft: '',
            messages: [...state.messages, { id: `user-${state.messages.length}`, role: 'user', content: action.pendingTurn.content }],
          }
        : state
    case 'TURN_FAILED':
      return state.phase === 'conversation' ? { ...state, status: 'retryable-error', error: action.message, answerSaved: action.answerSaved } : state
    case 'REVIEW_GENERATING':
      return state.phase === 'profile'
        ? { phase: 'review-generating', store: state.store, session: state.session, messages: [], status: 'loading', error: '' }
        : state.phase === 'conversation'
        ? { phase: 'review-generating', store: state.store, session: state.session, messages: state.messages, status: 'loading', error: '' }
        : state.phase === 'review-generating'
          ? { ...state, status: 'loading', error: '' }
        : state
    case 'REVIEW_FAILED':
      return state.phase === 'review-generating' ? { ...state, status: 'error', error: action.message } : state
    case 'REVIEW_READY':
      return state.phase === 'review-generating' || state.phase === 'review-editing'
        ? { phase: 'review-editing', store: state.store, session: state.session, review: action.review, remainingRewrites: action.remainingRewrites, status: 'idle', message: '', error: '' }
        : state
    case 'REVIEW_CHANGED':
      return state.phase === 'review-editing' ? { ...state, review: action.review, message: '', error: '' } : state
    case 'REVIEW_STATUS':
      return state.phase === 'review-editing' ? { ...state, status: action.status, message: action.message ?? '', error: action.error ?? '' } : state
    case 'COMPLETED':
      return state.phase === 'review-editing'
        ? { phase: 'completed', store: state.store, closingMessage: state.store.closingMessage ?? getPublicInterviewCopy(state.session.locale).defaultClosing }
        : state
  }
}
