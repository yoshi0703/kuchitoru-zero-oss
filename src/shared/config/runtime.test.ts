import { describe, expect, it } from 'vitest'
import { resolvePublicRuntimeConfig } from './runtime'

describe('resolvePublicRuntimeConfig', () => {
  it('prefers public window overrides to build-time values', () => {
    expect(resolvePublicRuntimeConfig({
      appOrigin: 'https://community.example/',
      supabaseUrl: 'https://runtime.supabase.example/',
      supabasePublishableKey: 'runtime-key',
      turnstileSiteKey: 'runtime-turnstile',
    }, {
      VITE_APP_ORIGIN: 'https://build.example',
      VITE_SUPABASE_URL: 'https://build.supabase.example',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'build-key',
      VITE_TURNSTILE_SITE_KEY: 'build-turnstile',
    }, 'https://fallback.example')).toEqual({
      appOrigin: 'https://community.example',
      supabaseUrl: 'https://runtime.supabase.example',
      supabasePublishableKey: 'runtime-key',
      turnstileSiteKey: 'runtime-turnstile',
    })
  })

  it('falls back to build-time values and the current origin', () => {
    expect(resolvePublicRuntimeConfig(undefined, {}, 'https://fallback.example')).toEqual({
      appOrigin: 'https://fallback.example',
      supabaseUrl: '',
      supabasePublishableKey: '',
      turnstileSiteKey: '',
    })
  })
})
