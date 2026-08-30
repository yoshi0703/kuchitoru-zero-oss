import {
  getAiConnection,
  getInterviewHistory,
  getMonthlySummary,
  getOwnerStore,
  type AiConnection,
  type InterviewRow,
  type MonthlySummary,
  type StoreRecord,
} from './owner-api'
import { validateGoogleReviewUrl } from '../../shared/lib/google-review-url'
import type { SurveyDefinitionV4 } from '../../shared/survey-config'
import { getSurveyConfig } from './survey-config-api'

type DashboardDependencies = {
  getStore: () => Promise<StoreRecord | null>
  getSurvey: () => Promise<SurveyDefinitionV4>
  getAi: () => Promise<AiConnection | null>
  getSummary: () => Promise<MonthlySummary | null>
  getRecent: () => Promise<{ rows: InterviewRow[] }>
}

export type DashboardSetupState = {
  storeInformationComplete: boolean
  surveyEditingComplete: boolean
  isComplete: boolean
}

export type DashboardData = {
  store: StoreRecord | null
  setup: DashboardSetupState
  ai: AiConnection | null
  summary: MonthlySummary | null
  recent: InterviewRow[]
}

export function storeInformationIsComplete(store: StoreRecord): boolean {
  if (!store.google_review_url) return false
  try {
    validateGoogleReviewUrl(store.google_review_url)
    return true
  } catch {
    return false
  }
}

export function surveyEditingIsComplete(survey: SurveyDefinitionV4): boolean {
  return survey.revision > 1
}

function dashboardSetupState(
  store: StoreRecord,
  survey: SurveyDefinitionV4,
): DashboardSetupState {
  const storeInformationComplete = storeInformationIsComplete(store)
  const surveyEditingComplete = surveyEditingIsComplete(survey)
  return {
    storeInformationComplete,
    surveyEditingComplete,
    isComplete: storeInformationComplete && surveyEditingComplete,
  }
}

function storeDependencies(storeId: string): DashboardDependencies {
  return {
    getStore: () => getOwnerStore(storeId),
    getSurvey: () => getSurveyConfig(storeId),
    getAi: () => getAiConnection(storeId),
    getSummary: () => getMonthlySummary(storeId),
    getRecent: () => getInterviewHistory(storeId),
  }
}

export async function loadDashboardData(
  storeIdOrDependencies: string | DashboardDependencies,
): Promise<DashboardData> {
  const dependencies = typeof storeIdOrDependencies === 'string'
    ? storeDependencies(storeIdOrDependencies)
    : storeIdOrDependencies
  const store = await dependencies.getStore()
  if (store === null) {
    return {
      store: null,
      setup: { storeInformationComplete: false, surveyEditingComplete: false, isComplete: false },
      ai: null,
      summary: null,
      recent: [],
    }
  }

  const setup = dashboardSetupState(store, await dependencies.getSurvey())
  if (!setup.isComplete) {
    return { store, setup, ai: null, summary: null, recent: [] }
  }

  const [ai, summary, recent] = await Promise.all([
    dependencies.getAi(),
    dependencies.getSummary(),
    dependencies.getRecent(),
  ])
  return { store, setup, ai, summary, recent: recent.rows.slice(0, 5) }
}
