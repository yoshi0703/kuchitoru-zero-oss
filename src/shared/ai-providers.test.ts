import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_CATALOG, AI_PROVIDER_IDS, aiModelFor, aiProviderCatalog, aiProviderLabel } from './ai-providers'

describe('AI provider catalog', () => {
  it('keeps the five durable provider IDs and user-facing labels aligned', () => {
    expect(AI_PROVIDER_IDS).toEqual(['openai', 'gemini', 'deepseek', 'xai', 'anthropic'])
    expect(AI_PROVIDER_IDS.map((provider) => aiProviderLabel(provider))).toEqual([
      'OpenAI',
      'Gemini',
      'DeepSeek',
      'Grok (xAI)',
      'Claude (Anthropic)',
    ])
  })

  it('discloses retention differences for non-OpenAI providers', () => {
    expect(AI_PROVIDER_CATALOG.openai.notice).toBeNull()
    expect(AI_PROVIDER_CATALOG.gemini.notice).toContain('製品改善')
    expect(AI_PROVIDER_CATALOG.deepseek.notice).toContain('中国')
    expect(AI_PROVIDER_CATALOG.xai.notice).toContain('30日')
    expect(AI_PROVIDER_CATALOG.anthropic.notice).toContain('30日')
  })

  it('provides official key-management destinations for every provider', () => {
    for (const provider of AI_PROVIDER_IDS) {
      expect(AI_PROVIDER_CATALOG[provider].keyUrl).toMatch(/^https:\/\//)
      expect(AI_PROVIDER_CATALOG[provider].keyLabel).toContain('APIキー')
    }
  })

  it('provides an allowlisted model picker without price data', () => {
    for (const provider of AI_PROVIDER_IDS) {
      const catalog = AI_PROVIDER_CATALOG[provider]
      expect(catalog.models).not.toHaveLength(0)
      expect(aiModelFor(provider, catalog.defaultModel)).toMatchObject({ id: catalog.defaultModel })
      for (const model of catalog.models) {
        expect(model).toEqual({ id: expect.any(String), label: expect.any(String) })
      }
    }
    expect(aiModelFor('anthropic', 'claude-sonnet-5').label).toBe('Claude Sonnet 5')
  })

  it('keeps the simplified model choices requested by the dashboard', () => {
    expect(AI_PROVIDER_CATALOG.openai.defaultModel).toBe('gpt-5.6-luna')
    expect(AI_PROVIDER_CATALOG.openai.models.map((model) => model.id)).toEqual(['gpt-5.6-luna'])
    expect(AI_PROVIDER_CATALOG.gemini.models.map((model) => model.id)).not.toContain('gemini-2.5-flash-lite')
    expect(AI_PROVIDER_CATALOG.xai.models.map((model) => model.id)).toEqual(['grok-4.5'])
  })
})

describe('English provider presentation', () => {
  it('localizes disclosure without changing provider or model contracts', () => {
    const catalog = aiProviderCatalog('en')
    expect(catalog.gemini.keyLabel).toBe('Get a Gemini API key')
    expect(catalog.deepseek.notice).toContain('China')
    expect(catalog.openai.defaultModel).toBe(AI_PROVIDER_CATALOG.openai.defaultModel)
    expect(catalog.xai.models.map(({ id }) => id)).toEqual(AI_PROVIDER_CATALOG.xai.models.map(({ id }) => id))
  })
})
