import { describe, expect, it } from 'vitest'
import { populatedExternalSecretNames } from './assert-no-external-api-env.mjs'

describe('external API environment guard', () => {
  it('accepts public browser configuration only', () => {
    expect(
      populatedExternalSecretNames({
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        VITE_SUPABASE_URL: 'http://127.0.0.1:56321',
        VITE_TURNSTILE_SITE_KEY: 'turnstile_test',
      }),
    ).toEqual([])
  })

  it('reports variable names without exposing their values', () => {
    const secret = 'must-never-appear-in-output'
    const findings = populatedExternalSecretNames({
      ANTHROPIC_API_KEY: secret,
      DEEPSEEK_API_KEY: secret,
      OPENAI_API_KEY: secret,
      SUPABASE_SERVICE_ROLE_KEY: secret,
      XAI_API_KEY: secret,
    })

    expect(findings).toEqual([
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
      'OPENAI_API_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'XAI_API_KEY',
    ])
    expect(findings.join(' ')).not.toContain(secret)
  })
})
