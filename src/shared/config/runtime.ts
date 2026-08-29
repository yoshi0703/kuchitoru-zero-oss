const normalizeOrigin = (value: string | undefined) => value?.replace(/\/$/, '') ?? ''

export type KuchitoruPublicRuntimeConfig = {
  appOrigin?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  turnstileSiteKey?: string
}

declare global {
  interface Window {
    __KUCHITORU_RUNTIME_CONFIG__?: KuchitoruPublicRuntimeConfig
  }
}

type RuntimeEnvironment = Record<string, string | boolean | undefined>

export function resolvePublicRuntimeConfig(
  overrides: KuchitoruPublicRuntimeConfig | undefined,
  env: RuntimeEnvironment,
  fallbackOrigin: string,
) {
  return {
    supabaseUrl: normalizeOrigin(overrides?.supabaseUrl ?? stringEnv(env.VITE_SUPABASE_URL)),
    supabasePublishableKey: overrides?.supabasePublishableKey ?? stringEnv(env.VITE_SUPABASE_PUBLISHABLE_KEY) ?? '',
    turnstileSiteKey: overrides?.turnstileSiteKey ?? stringEnv(env.VITE_TURNSTILE_SITE_KEY) ?? '',
    appOrigin: normalizeOrigin(overrides?.appOrigin ?? stringEnv(env.VITE_APP_ORIGIN)) || fallbackOrigin,
  }
}

function stringEnv(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

const publicRuntimeConfig = resolvePublicRuntimeConfig(
  window.__KUCHITORU_RUNTIME_CONFIG__,
  import.meta.env,
  window.location.origin,
)

export const runtimeConfig = Object.freeze({
  ...publicRuntimeConfig,
  googleAuthEnabled: import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true',
  isE2ETestMode: import.meta.env.VITE_E2E_TEST_MODE === '1',
})

export const hasSupabaseConfiguration =
  runtimeConfig.supabaseUrl.length > 0 && runtimeConfig.supabasePublishableKey.length > 0
