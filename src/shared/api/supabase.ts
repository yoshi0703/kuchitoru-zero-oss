import { createClient } from '@supabase/supabase-js'
import { hasSupabaseConfiguration, runtimeConfig } from '../config/runtime'

export const supabase = hasSupabaseConfiguration
  ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabasePublishableKey, {
      db: { schema: 'api' },
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null
