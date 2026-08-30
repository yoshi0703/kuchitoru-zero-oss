import path from 'node:path'
import { pathToFileURL } from 'node:url'

const forbiddenEnvironmentVariables = [
  'AI_CREDENTIALS_MASTER_KEY_V1',
  'AI_CREDENTIALS_MASTER_KEY_V2',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_BUSINESS_CLIENT_SECRET',
  'INSTAGRAM_APP_SECRET',
  'OPENAI_API_KEY',
  'RATE_LIMIT_HMAC_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TURNSTILE_SECRET_KEY',
  'XAI_API_KEY',
]

export function populatedExternalSecretNames(environment = process.env) {
  return forbiddenEnvironmentVariables.filter((name) => {
    const value = environment[name]
    return typeof value === 'string' && value.trim().length > 0
  })
}

function main() {
  const populatedNames = populatedExternalSecretNames()

  if (populatedNames.length > 0) {
    console.error(
      `External API or server secret variables are forbidden in automated tests: ${populatedNames.join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  console.log('External API secret environment guard passed')
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main()
}
