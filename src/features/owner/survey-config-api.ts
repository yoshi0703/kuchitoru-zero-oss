import { apiRequest } from '../../shared/api/http'
import { runtimeConfig } from '../../shared/config/runtime'
import {
  DEFAULT_SURVEY_CONFIG,
  SURVEY_DEFINITION_SCHEMA,
  SURVEY_PRESETS,
  upcastV3ToV4,
  type SurveyDefinitionV4,
  type SurveyPreset,
} from '../../shared/survey-config'

let e2eSurveyConfig = upcastV3ToV4(structuredClone(DEFAULT_SURVEY_CONFIG))

export async function getSurveyConfig(storeId: string): Promise<SurveyDefinitionV4> {
  if (runtimeConfig.isE2ETestMode) return structuredClone(e2eSurveyConfig)

  const data = await apiRequest<unknown>(`/owner-api/v3/stores/${storeId}/survey-config`, {
    ownerAuth: true,
  })
  return SURVEY_DEFINITION_SCHEMA.parse(data)
}

export async function saveSurveyConfig(storeId: string, input: SurveyDefinitionV4): Promise<SurveyDefinitionV4> {
  const parsed = SURVEY_DEFINITION_SCHEMA.parse(input)
  if (runtimeConfig.isE2ETestMode) {
    e2eSurveyConfig = structuredClone(parsed)
    return structuredClone(e2eSurveyConfig)
  }

  const data = await apiRequest<unknown>(`/owner-api/v3/stores/${storeId}/survey-config`, {
    method: 'PUT',
    body: parsed,
    ownerAuth: true,
  })
  return SURVEY_DEFINITION_SCHEMA.parse(data)
}

export async function getSurveyPresets(): Promise<SurveyPreset[]> {
  if (runtimeConfig.isE2ETestMode) return structuredClone([...SURVEY_PRESETS])
  return apiRequest<SurveyPreset[]>('/owner-api/v2/survey-presets', {
    ownerAuth: true,
  })
}
