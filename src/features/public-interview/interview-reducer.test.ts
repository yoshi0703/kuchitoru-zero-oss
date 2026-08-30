import { describe, expect, it } from 'vitest'
import { initialInterviewState, interviewReducer } from './interview-reducer'
import { DEFAULT_SURVEY_CONFIG } from '../../shared/survey-config'

const store = { publicSlug:'store',name:'店舗',industry:null,description:null,welcomeMessage:null,closingMessage:null,surveyConfig:DEFAULT_SURVEY_CONFIG,surveyRevision:1 }
const session = { sessionId:'11111111-1111-4111-8111-111111111111',sessionToken:'token-token-token-token',expiresAt:'2026-07-10T00:30:00Z',surveyConfig:DEFAULT_SURVEY_CONFIG,surveyRevision:1,locale:'ja' as const }

describe('interviewReducer', () => {
  it('never invents a conversation before server-confirmed resume state', () => {
    const found = interviewReducer(initialInterviewState, { type:'SESSION_FOUND',store,session,draft:'下書き' })
    expect(found.phase).toBe('resume-offer')
  })

  it('routes ready-for-review resume into review generation', () => {
    const found = interviewReducer(initialInterviewState, { type:'SESSION_FOUND',store,session,draft:'' })
    const resumed = interviewReducer(found, { type:'SESSION_RESUMED',result:{status:'active',turnCount:4,maxTurns:8,interviewComplete:true,generationStatus:'not_started',rewriteCount:0,editedReview:null,remainingRewrites:2,next:{kind:'ready_for_review'}} })
    expect(resumed.phase).toBe('review-generating')
  })

  it('normalizes legacy conversation resumes to the dynamic survey', () => {
    const found = interviewReducer(initialInterviewState, { type:'SESSION_FOUND',store,session,draft:'' })
    const resumed = interviewReducer(found, { type:'SESSION_RESUMED',result:{status:'active',turnCount:1,maxTurns:8,interviewComplete:false,generationStatus:'not_started',rewriteCount:0,editedReview:null,remainingRewrites:2,next:{kind:'conversation',lastAssistantQuestion:'質問'}} })
    expect(resumed.phase).toBe('profile')
  })

  it('starts review generation directly from the dynamic survey', () => {
    const welcome = interviewReducer(initialInterviewState, { type:'STORE_READY',store })
    const starting = interviewReducer(welcome, { type:'STARTING' })
    const survey = interviewReducer(starting, { type:'SESSION_STARTED',session })
    const generating = interviewReducer(survey, { type:'REVIEW_GENERATING' })
    expect(generating.phase).toBe('review-generating')
  })
})
