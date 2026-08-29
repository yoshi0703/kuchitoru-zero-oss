import { describe, expect, it, vi } from 'vitest'

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }))

vi.mock('../../shared/api/http', () => ({ apiRequest: apiRequestMock }))
vi.mock('../../shared/config/runtime', () => ({
  runtimeConfig: { isE2ETestMode: true },
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: null }))

import {
  getAiConnection,
  getAiConnections,
  revalidateAiConnection,
  selectAiModel,
  selectAiProvider,
  validateAndSaveAiConnection,
  type AiConnection,
} from './owner-api'

const storeId = '44444444-4444-4444-8444-444444444444'

function expectPublicContract(connection: AiConnection | null) {
  expect(connection).not.toBeNull()
  expect(Object.keys(connection ?? {}).sort()).toEqual(['keyLast4', 'model', 'provider', 'status'])
}

describe('owner AI connection E2E responses', () => {
  it('returns only the four public connection fields', async () => {
    const current = await getAiConnection(storeId)
    const connections = await getAiConnections(storeId)
    const saved = await validateAndSaveAiConnection(storeId, {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      apiKey: 'private-example-key',
      activate: false,
    })
    const revalidated = await revalidateAiConnection(storeId, 'deepseek')
    const selected = await selectAiProvider(storeId, 'xai')
    const modelSelected = await selectAiModel(storeId, 'anthropic', 'claude-sonnet-4-6')

    const responses = [current, ...connections, saved, revalidated, selected, modelSelected]
    responses.forEach(expectPublicContract)
    expect(apiRequestMock).not.toHaveBeenCalled()
  })
})
