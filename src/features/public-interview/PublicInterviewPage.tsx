import { CheckCircle2, ChevronLeft, Clipboard, MapPinned, MessageCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../../shared/api/http'
import { runtimeConfig } from '../../shared/config/runtime'
import { copyText } from '../../shared/lib/clipboard'
import { createIdempotencyKey } from '../../shared/lib/idempotency'
import type { SurveyQuestion } from '../../shared/survey-config'
import {
  clearInterviewSession,
  loadInterviewSession,
  saveInterviewSession,
} from '../../shared/lib/interview-session-storage'
import { useI18n } from '../../shared/i18n'
import { AppFooter, Button, LoadingState, Notice } from '../../shared/ui/ui'
import {
  generateReview,
  getPublicStore,
  recordReviewHandoff,
  resumeInterviewSession,
  rewriteReview,
  saveInterviewTurn,
  saveReviewEdit,
  startInterviewSession,
  type InterviewSession,
} from './public-interview-api'
import { initialInterviewState, interviewReducer } from './interview-reducer'
import { useInterviewViewport } from './useInterviewViewport'
import { CustomQuestionField, type SurveyAnswerValue } from './CustomQuestionField'
import { getPublicInterviewCopy } from './copy'
import { GoogleReviewHandoffDialog } from './GoogleReviewHandoffDialog'
import { surveySourceContainsJapanese } from './survey-source-language'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

function TurnstileWidget({ onToken, locale }: { onToken: (token: string) => void; locale: 'ja' | 'en' }) {
  const c = getPublicInterviewCopy(locale)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (runtimeConfig.isE2ETestMode) { onToken('e2e-turnstile-token'); return }
    if (!runtimeConfig.turnstileSiteKey || !ref.current) return
    let widgetId = ''
    const render = () => {
      if (window.turnstile && ref.current) {
        widgetId = window.turnstile.render(ref.current, {
          sitekey: runtimeConfig.turnstileSiteKey,
          action: 'interview_start',
          appearance: 'interaction-only',
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        })
      }
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-kuchitoru-turnstile]')
    if (existing && window.turnstile) render()
    else if (existing) existing.addEventListener('load', render, { once: true })
    else {
      const script = document.createElement('script'); script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async=true; script.defer=true; script.dataset.kuchitoruTurnstile='true'; script.addEventListener('load',render); document.head.append(script)
    }
    return () => { existing?.removeEventListener('load', render); if (widgetId) window.turnstile?.remove(widgetId) }
  }, [onToken])
  if (!runtimeConfig.isE2ETestMode && !runtimeConfig.turnstileSiteKey) return <Notice tone="error">{c.securityUnavailable}</Notice>
  return <div className="turnstile-box" ref={ref} aria-label={c.securityCheck} />
}

function isSurveyAnswerComplete(
  question: SurveyQuestion,
  value: SurveyAnswerValue | undefined,
): value is SurveyAnswerValue {
  if (question.type === 'short_text' || question.type === 'long_text') {
    return typeof value === 'string' && value.trim().length > 0
  }
  if (question.type === 'rating_5') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
  }
  if (question.type === 'multi_choice') {
    return Array.isArray(value) && value.length > 0
  }
  return typeof value === 'string' && value !== 'other:' && value.trim().length > 0
}

export function PublicInterviewPage() {
  const { publicSlug = '' } = useParams()
  const { locale } = useI18n()
  const [state, dispatch] = useReducer(interviewReducer, initialInterviewState)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileAttempt, setTurnstileAttempt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const startKeyRef = useRef(createIdempotencyKey())
  const profileKeyRef = useRef(createIdempotencyKey())
  const reviewKeyRef = useRef(createIdempotencyKey())
  const rewriteKeyRef = useRef(createIdempotencyKey())
  const saveReviewKeyRef = useRef(createIdempotencyKey())
  const copyHandoffKeyRef = useRef(createIdempotencyKey())
  const googleHandoffKeyRef = useRef(createIdempotencyKey())
  const reviewEditorRef = useRef<HTMLTextAreaElement>(null)
  const handoffInFlightRef = useRef(false)
  const handoffTriggerRef = useRef<HTMLButtonElement>(null)
  const previousSlugRef = useRef(publicSlug)
  const localeRef = useRef(locale)
  const [handoffDialogOpen, setHandoffDialogOpen] = useState(false)
  const navigate = useNavigate()
  const active = !['loading-store','unavailable','welcome','resume-offer','completed'].includes(state.phase)
  useInterviewViewport(active)
  const sessionLocale = 'session' in state ? state.session.locale : locale
  const c = getPublicInterviewCopy(sessionLocale)

  useEffect(() => { localeRef.current = locale }, [locale])

  useEffect(() => {
    if (previousSlugRef.current !== publicSlug) {
      clearInterviewSession(previousSlugRef.current)
      previousSlugRef.current = publicSlug
    }
  }, [publicSlug])

  useEffect(() => {
    if (state.phase === 'completed') clearInterviewSession(publicSlug)
  }, [publicSlug, state.phase])

  useEffect(() => {
    let cancelled = false
    void getPublicStore(publicSlug).then((store) => {
      if (cancelled) return
      const stored = loadInterviewSession(publicSlug)
      if (stored) {
        setAnswers({})
        setCurrentQuestionIndex(0)
        dispatch({ type:'SESSION_FOUND', store, session:{ sessionId:stored.sessionId,sessionToken:stored.sessionToken,expiresAt:stored.expiresAt,surveyConfig:stored.surveyConfig,surveyRevision:stored.surveyRevision,locale:stored.locale }, draft:'' })
      } else dispatch({ type:'STORE_READY', store })
    }).catch(() => { if (!cancelled) { clearInterviewSession(publicSlug); dispatch({type:'STORE_FAILED',message:getPublicInterviewCopy(localeRef.current).unavailable}) } })
    return () => { cancelled=true }
  }, [publicSlug])

  const start = async () => {
    if (state.phase !== 'welcome' || !turnstileToken) return
    dispatch({type:'STARTING'})
    try {
      const session = await startInterviewSession({publicSlug,turnstileToken,locale,idempotencyKey:startKeyRef.current})
      setAnswers({})
      setCurrentQuestionIndex(0)
      saveInterviewSession({publicSlug,sessionId:session.sessionId,sessionToken:session.sessionToken,expiresAt:session.expiresAt,surveyConfig:session.surveyConfig,surveyRevision:session.surveyRevision,locale:session.locale})
      dispatch({type:'SESSION_STARTED',session})
    } catch (caught) {
      setTurnstileToken('')
      setTurnstileAttempt((value) => value + 1)
      const message = caught instanceof ApiError
        ? {
            STORE_NOT_AVAILABLE: c.storeNotAvailable,
            TURNSTILE_REQUIRED: c.securityFailed,
            TURNSTILE_FAILED: c.securityFailed,
            RATE_LIMIT_EXCEEDED: c.rateLimited,
            NETWORK_ERROR: c.networkError,
          }[caught.code] ?? c.startFallback
        : c.startFallback
      dispatch({type:'START_FAILED',message})
    }
  }

  const surveySubmit = async () => {
    if (state.phase !== 'profile') return
    dispatch({type:'PROFILE_BUSY',busy:true})
    try {
      const serializedAnswers = Object.fromEntries(
        state.session.surveyConfig.questions.flatMap((question) => {
          const value = answers[question.id]
          return isSurveyAnswerComplete(question, value)
            ? [[question.id, { type: question.type, value }]]
            : []
        }),
      )
      const body = {
        kind: 'survey' as const,
        surveyRevision: state.session.surveyRevision,
        answers: serializedAnswers,
      }
      const result=await saveInterviewTurn({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken,body,idempotencyKey:profileKeyRef.current})
      if (result.next.kind!=='ready_for_review') throw new Error(c.surveyCompleteError)
      profileKeyRef.current=createIdempotencyKey()
      dispatch({type:'REVIEW_GENERATING'})
      try {
        const attemptKey=reviewKeyRef.current
        reviewKeyRef.current=createIdempotencyKey()
        const reviewResult=await generateReview({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken,idempotencyKey:attemptKey,locale:state.session.locale})
        dispatch({type:'REVIEW_READY',review:reviewResult.review,remainingRewrites:reviewResult.remainingRewrites})
      } catch {
        dispatch({type:'REVIEW_FAILED',message:c.generationError})
      }
    } catch(caught){
      const error = caught instanceof ApiError
        ? { RATE_LIMIT_EXCEEDED: c.rateLimited, NETWORK_ERROR: c.networkError }[caught.code] ?? c.surveySaveError
        : c.surveySaveError
      dispatch({type:'PROFILE_BUSY',busy:false,error})
    }
  }

  const createReview = useCallback(async (session: InterviewSession) => {
    dispatch({type:'REVIEW_GENERATING'})
    const attemptKey=reviewKeyRef.current
    reviewKeyRef.current=createIdempotencyKey()
    try { const result=await generateReview({sessionId:session.sessionId,sessionToken:session.sessionToken,idempotencyKey:attemptKey,locale:session.locale});dispatch({type:'REVIEW_READY',review:result.review,remainingRewrites:result.remainingRewrites}) }
    catch{dispatch({type:'REVIEW_FAILED',message:c.generationError})}
  },[c.generationError])

  const resume = async () => {
    if (state.phase !== 'resume-offer') return
    dispatch({type:'RESUME_BUSY',busy:true})
    try {
      const result = await resumeInterviewSession({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken})
      dispatch({type:'SESSION_RESUMED',result})
    } catch (caught) {
      if (caught instanceof ApiError && [401, 404, 410].includes(caught.status)) {
        clearInterviewSession(publicSlug)
        dispatch({type:'STORE_READY',store:state.store})
        return
      }
      const error = caught instanceof ApiError
        ? { RATE_LIMIT_EXCEEDED: c.rateLimited, NETWORK_ERROR: c.networkError }[caught.code] ?? c.resumeError
        : c.resumeError
      dispatch({type:'RESUME_BUSY',busy:false,error})
    }
  }

  if (state.phase==='loading-store') return <main className="interview-centered"><LoadingState label={c.storeLoading} /></main>
  if (state.phase==='unavailable') return <main className="interview-centered"><Notice tone="error">{state.message}</Notice><Link to="/">{c.backHome}</Link></main>
  if (state.phase==='welcome') return <main className="interview-welcome"><header className="interview-welcome__toolbar"><strong>{state.store.name}</strong></header><section className="interview-welcome__card"><div className="interview-welcome__hero"><p className="interview-eyebrow">{c.welcomeEyebrow(state.store.surveyConfig.questions.length)}</p><h1>{c.welcomeTitle}</h1><p>{c.welcomeBody}</p></div><div className="interview-welcome__action">{state.error?<Notice tone="error">{state.error}</Notice>:null}<TurnstileWidget key={turnstileAttempt} locale={locale} onToken={setTurnstileToken}/><Button data-testid="interview-start" disabled={!turnstileToken} onClick={()=>void start()}>{c.start}</Button></div><details className="interview-privacy"><summary>{c.privacyTitle}</summary><div className="interview-privacy__content"><p>{c.privacyBody}</p><AppFooter /></div></details></section></main>
  if (state.phase==='resume-offer') return <main className="interview-centered"><MessageCircle aria-hidden="true" /><h1>{c.resumeTitle}</h1><p>{c.resumeBody}</p>{state.error?<Notice tone="error">{state.error}</Notice>:null}<Button busy={state.busy} onClick={()=>void resume()}>{c.resume}</Button><Button variant="quiet" disabled={state.busy} onClick={()=>{clearInterviewSession(publicSlug);dispatch({type:'STORE_READY',store:state.store})}}>{c.startNew}</Button></main>
  if (state.phase==='starting') return <main className="interview-centered"><LoadingState label={c.preparing} /></main>
  if (state.phase==='profile') {
    const config = state.session.surveyConfig
    const question = config.questions[currentQuestionIndex]
    if (!question) return <InterviewShell name={state.store.name} progress={c.survey}><Notice tone="error">{c.questionLoadError}</Notice></InterviewShell>
    const value = answers[question.id]
    const complete = isSurveyAnswerComplete(question, value)
    const isLast = currentQuestionIndex === config.questions.length - 1
    const canContinue = !question.required || complete
    const advance = () => {
      if (!canContinue) return
      if (isLast) void surveySubmit()
      else setCurrentQuestionIndex((index) => index + 1)
    }
    return <InterviewShell name={state.store.name} progress={`${currentQuestionIndex + 1} / ${config.questions.length}`}><form className="profile-step survey-step" onSubmit={(event)=>{event.preventDefault();advance()}}><div className="survey-step__progress" aria-hidden="true"><span style={{width:`${((currentQuestionIndex + 1) / config.questions.length) * 100}%`}} /></div>{currentQuestionIndex===0?<div className="survey-step__introduction"><h1>{config.title}</h1><p>{config.description}</p></div>:<h1 className="sr-only">{config.title}</h1>}<p className="survey-step__eyebrow">{c.question} {currentQuestionIndex + 1}</p>{sessionLocale === 'en' && surveySourceContainsJapanese(config) ? <Notice tone="info">{c.sourceJapanese}</Notice> : null}<div className="profile-step__question"><CustomQuestionField locale={sessionLocale} question={question} {...(value===undefined?{}:{value})} idPrefix="public-survey" onChange={(nextValue)=>{profileKeyRef.current=createIdempotencyKey();setAnswers((current)=>nextValue===undefined?Object.fromEntries(Object.entries(current).filter(([id])=>id!==question.id)):{...current,[question.id]:nextValue})}} /></div>{state.error?<Notice tone="error">{state.error}</Notice>:null}<div className="survey-step__actions">{currentQuestionIndex > 0?<Button type="button" variant="quiet" className="survey-step__back" onClick={()=>setCurrentQuestionIndex((index)=>Math.max(index - 1,0))}><ChevronLeft aria-hidden="true" />{c.back}</Button>:<span /> }<Button type="submit" data-testid={isLast?'profile-submit':complete||question.required?'question-next':'question-skip'} disabled={!canContinue} busy={isLast&&state.busy}>{isLast?c.submit:complete||question.required?c.next:c.skip}</Button></div></form></InterviewShell>
  }
  if(state.phase==='review-generating') return <InterviewShell name={state.store.name} progress={c.reviewPreparing}><div className="interview-centered">{state.status==='loading'?<LoadingState label={c.generating} />:<><Notice tone="error">{state.error}</Notice><p>{c.answersSaved}</p><Button onClick={()=>void createReview(state.session)}>{c.retry}</Button></>}</div></InterviewShell>
  if(state.phase==='review-editing') {
    const save=async()=>{dispatch({type:'REVIEW_STATUS',status:'saving'});try{const result=await saveReviewEdit({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken,review:state.review,idempotencyKey:saveReviewKeyRef.current});saveReviewKeyRef.current=createIdempotencyKey();copyHandoffKeyRef.current=createIdempotencyKey();googleHandoffKeyRef.current=createIdempotencyKey();dispatch({type:'REVIEW_READY',review:result.review,remainingRewrites:result.remainingRewrites});dispatch({type:'REVIEW_STATUS',status:'idle',message:c.saved})}catch{dispatch({type:'REVIEW_STATUS',status:'idle',error:c.saveError})}}
    const rewrite=async()=>{dispatch({type:'REVIEW_STATUS',status:'rewriting'});const attemptKey=rewriteKeyRef.current;rewriteKeyRef.current=createIdempotencyKey();try{const result=await rewriteReview({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken,idempotencyKey:attemptKey,locale:state.session.locale});saveReviewKeyRef.current=createIdempotencyKey();copyHandoffKeyRef.current=createIdempotencyKey();googleHandoffKeyRef.current=createIdempotencyKey();dispatch({type:'REVIEW_READY',review:result.review,remainingRewrites:result.remainingRewrites})}catch{dispatch({type:'REVIEW_STATUS',status:'idle',error:c.generationError})}}
    const selectReviewText=()=>{reviewEditorRef.current?.focus();reviewEditorRef.current?.select()}
    const copy=async(source:'editor'|'dialog')=>{dispatch({type:'REVIEW_STATUS',status:'copying'});try{const copied=await copyText(state.review);if(!copied)throw new Error(source === 'editor' ? c.copyEditorFallback : c.copyDialogFallback);await recordReviewHandoff({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken,eventType:'review_text_copied',editedReview:state.review,idempotencyKey:copyHandoffKeyRef.current});copyHandoffKeyRef.current=createIdempotencyKey();dispatch({type:'REVIEW_STATUS',status:'idle',message:c.copied})}catch{selectReviewText();dispatch({type:'REVIEW_STATUS',status:'idle',error:source === 'editor' ? c.copyEditorFallback : c.copyDialogFallback})}}
    // Only the confirmation dialog's primary button reaches this: the blank tab must open inside that synchronous click.
    const google=async()=>{if(handoffInFlightRef.current)return;handoffInFlightRef.current=true;const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;dispatch({type:'REVIEW_STATUS',status:'handoff'});try{const result=await recordReviewHandoff({sessionId:state.session.sessionId,sessionToken:state.session.sessionToken,eventType:'google_review_opened',editedReview:state.review,idempotencyKey:googleHandoffKeyRef.current});if(!result.googleReviewUrl)throw new Error(c.googleUrlError);clearInterviewSession(publicSlug);if(popup)popup.location.replace(result.googleReviewUrl);else window.location.assign(result.googleReviewUrl);setHandoffDialogOpen(false);dispatch({type:'COMPLETED'})}catch{popup?.close();setHandoffDialogOpen(false);dispatch({type:'REVIEW_STATUS',status:'idle',error:c.googleOpenError})}finally{handoffInFlightRef.current=false}}
    return <InterviewShell name={state.store.name} progress={c.reviewCheck}><section className="review-editor"><p className="survey-step__eyebrow">{c.answered}</p><h1>{c.reviewCheck}</h1><p>{c.editBody}</p><label htmlFor="review-editor">{c.reviewText}</label><textarea ref={reviewEditorRef} id="review-editor" data-testid="review-editor" maxLength={800} value={state.review} onChange={(event)=>{saveReviewKeyRef.current=createIdempotencyKey();copyHandoffKeyRef.current=createIdempotencyKey();googleHandoffKeyRef.current=createIdempotencyKey();dispatch({type:'REVIEW_CHANGED',review:event.target.value})}}/><p className="character-count">{state.review.length} / 800 {c.characters}</p>{state.message?<Notice tone="success">{state.message}</Notice>:null}{state.error?<Notice tone="error">{state.error}</Notice>:null}<Button ref={handoffTriggerRef} data-testid="google-handoff" busy={state.status==='handoff'} disabled={state.status!=='idle'&&state.status!=='handoff'} onClick={()=>setHandoffDialogOpen(true)}><MapPinned/>{c.openGoogle}</Button><Button data-testid="review-copy" variant="secondary" busy={state.status==='copying'} disabled={state.status!=='idle'&&state.status!=='copying'} onClick={()=>void copy('editor')}><Clipboard/>{c.copyText}</Button><div className="review-editor__tools"><Button variant="quiet" disabled={state.remainingRewrites===0||state.status!=='idle'} onClick={()=>void rewrite()}><RefreshCw/>{state.error?c.retry:c.regenerate} <small>{c.remaining(state.remainingRewrites)}</small></Button><Button data-testid="review-save" variant="quiet" busy={state.status==='saving'} disabled={state.status!=='idle'&&state.status!=='saving'} onClick={()=>void save()}>{c.saveEdit}</Button></div>{state.store.googleMapsUrl?<a className="button button--secondary" data-testid="google-maps-handoff" href={state.store.googleMapsUrl} target="_blank" rel="noopener noreferrer"><MapPinned/>{c.viewStore}</a>:null}<Button variant="quiet" disabled={state.status!=='idle'} onClick={()=>{clearInterviewSession(publicSlug);dispatch({type:'COMPLETED'})}}>{c.finishWithoutPosting}</Button><GoogleReviewHandoffDialog locale={sessionLocale} open={handoffDialogOpen} triggerRef={handoffTriggerRef} status={state.status==='copying'||state.status==='handoff'?state.status:'idle'} message={state.message} error={state.error} onOpenChange={setHandoffDialogOpen} onCopy={()=>void copy('dialog')} onConfirm={()=>void google()} /></section></InterviewShell>
  }
  if (state.phase==='conversation') return <main className="interview-centered"><Notice tone="info">{c.oldSession}</Notice><Button onClick={()=>{clearInterviewSession(publicSlug);dispatch({type:'STORE_READY',store:state.store})}}>{c.startFixed}</Button></main>
  return <main className="interview-centered interview-completed"><CheckCircle2 aria-hidden="true" /><h1>{c.thanks}</h1><p>{state.closingMessage}</p><Button onClick={()=>navigate('/')}>{c.finish}</Button></main>
}

function InterviewShell({name,progress,children}:{name:string;progress:string;children:React.ReactNode}){return <main className="interview-shell"><header className="interview-shell__toolbar"><strong><MessageCircle aria-hidden="true" />{name}</strong><span className="interview-shell__status">{progress}</span></header><div className="interview-shell__body">{children}</div></main>}
