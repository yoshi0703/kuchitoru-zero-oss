import { describe, expect, it } from 'vitest'
import { publicAiProviderLabel } from './public-ai-provider'

describe('publicAiProviderLabel', () => {
  it('keeps the recorded BYOK provider visible', () => {
    expect(publicAiProviderLabel('openai')).toBe('openai')
    expect(publicAiProviderLabel('deepseek')).toBe('deepseek')
    expect(publicAiProviderLabel(null)).toBe('—')
  })
})

it('does not rewrite provider identifiers by locale', () => {
  expect(publicAiProviderLabel('openai')).toBe('openai')
})
