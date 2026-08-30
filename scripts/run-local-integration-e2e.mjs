import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { populatedExternalSecretNames } from './assert-no-external-api-env.mjs'

const projectRoot = process.cwd()
const supabase = ['corepack', ['pnpm', 'exec', 'supabase']]
let startedByHarness = false
let temporaryDirectory = null

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed with exit code ${result.status}`)
  }
}

function runWithoutCredentialOutput(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}; raw CLI output was withheld because it may contain local credentials`)
  }
}

function supabaseStatus() {
  const result = spawnSync(supabase[0], [...supabase[1], 'status', '-o', 'json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error('Could not parse local Supabase status without exposing credentials')
  }
}

function statusValue(status, ...names) {
  for (const name of names) {
    const value = status[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  throw new Error(`Local Supabase status is missing ${names.join(' or ')}`)
}

function edgeEnvironmentFile(turnstileSecret) {
  temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'kuchitoru-integration-'))
  const file = path.join(temporaryDirectory, 'edge.env')
  const secret = () => randomBytes(32).toString('base64')
  const lines = [
    `AI_CREDENTIALS_MASTER_KEY_V1=${secret()}`,
    'AI_CREDENTIALS_ACTIVE_KEY_VERSION=1',
    `SESSION_TOKEN_DERIVATION_KEY=${secret()}`,
    `RATE_LIMIT_HMAC_KEY=${secret()}`,
    `TURNSTILE_SECRET_KEY=${turnstileSecret}`,
    'KUCHITORU_LOCAL_INTEGRATION=1',
    'TURNSTILE_SITEVERIFY_URL=http://host.docker.internal:4175/turnstile/v0/siteverify',
    'ALLOWED_ORIGINS=http://127.0.0.1:4174',
    'OPENAI_INTERVIEW_MODEL=integration-openai-interview',
    'OPENAI_REVIEW_MODEL=integration-openai-review',
    'OPENAI_REWRITE_MODEL=integration-openai-rewrite',
    'GEMINI_INTERVIEW_MODEL=integration-gemini-interview',
    'GEMINI_REVIEW_MODEL=integration-gemini-review',
    'GEMINI_REWRITE_MODEL=integration-gemini-rewrite',
    'DEEPSEEK_INTERVIEW_MODEL=integration-deepseek-interview',
    'DEEPSEEK_REVIEW_MODEL=integration-deepseek-review',
    'DEEPSEEK_REWRITE_MODEL=integration-deepseek-rewrite',
    'XAI_INTERVIEW_MODEL=integration-xai-interview',
    'XAI_REVIEW_MODEL=integration-xai-review',
    'XAI_REWRITE_MODEL=integration-xai-rewrite',
    'ANTHROPIC_INTERVIEW_MODEL=integration-anthropic-interview',
    'ANTHROPIC_REVIEW_MODEL=integration-anthropic-review',
    'ANTHROPIC_REWRITE_MODEL=integration-anthropic-rewrite',
  ]
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}

function cleanup() {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  if (startedByHarness) {
    spawnSync(supabase[0], [...supabase[1], 'stop', '--no-backup'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    })
  }
}

try {
  if (process.env.KUCHITORU_ALLOW_LOCAL_DB_RESET !== '1') {
    throw new Error(
      'This test deletes and recreates the repository local Supabase database. Re-run with KUCHITORU_ALLOW_LOCAL_DB_RESET=1 only after confirming no local data is needed.',
    )
  }
  const forbidden = populatedExternalSecretNames()
  if (forbidden.length > 0) {
    throw new Error(
      `Unset external/provider secrets before integration testing: ${forbidden.join(', ')}`,
    )
  }

  let status = supabaseStatus()
  if (!status) {
    runWithoutCredentialOutput(
      supabase[0],
      [...supabase[1], 'start', '--exclude', 'edge-runtime'],
      'Local Supabase start',
    )
    startedByHarness = true
    status = supabaseStatus()
  }
  if (!status) throw new Error('Local Supabase did not become ready')

  run(supabase[0], [...supabase[1], 'db', 'reset', '--local'])

  const turnstileSecret = randomBytes(32).toString('base64url')
  const turnstileToken = randomBytes(32).toString('base64url')
  const environment = {
    ...process.env,
    KUCHITORU_INTEGRATION_API_URL: statusValue(status, 'API_URL'),
    KUCHITORU_INTEGRATION_EDGE_ENV_FILE: edgeEnvironmentFile(turnstileSecret),
    KUCHITORU_INTEGRATION_PUBLISHABLE_KEY: statusValue(
      status,
      'PUBLISHABLE_KEY',
      'ANON_KEY',
    ),
    KUCHITORU_INTEGRATION_SECRET_KEY: statusValue(
      status,
      'SECRET_KEY',
      'SERVICE_ROLE_KEY',
    ),
    KUCHITORU_INTEGRATION_TURNSTILE_SECRET: turnstileSecret,
    KUCHITORU_INTEGRATION_TURNSTILE_TOKEN: turnstileToken,
  }
  const result = spawnSync(
    'corepack',
    ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.integration.config.ts'],
    {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local integration E2E failed')
  process.exitCode = 1
} finally {
  cleanup()
}
