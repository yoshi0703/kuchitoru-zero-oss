import { execFileSync } from 'node:child_process'
import { rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(repositoryRoot, 'public/_deployment.json')

function resolveBuildSha() {
  const environmentSha = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA
  const sha = environmentSha ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Build SHA must be a full 40-character Git SHA')
  return sha.toLowerCase()
}

const metadata = {
  schemaVersion: 2,
  buildSha: resolveBuildSha(),
  releaseChannel: process.env.DEPLOY_ENV ?? 'local',
  appOrigin: process.env.VITE_APP_ORIGIN ?? '',
  supabaseOrigin: process.env.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  turnstileSiteKey: process.env.VITE_TURNSTILE_SITE_KEY ?? '',
  googleAuthEnabled: process.env.VITE_GOOGLE_AUTH_ENABLED === 'true',
}

if (!['local', 'staging', 'production'].includes(metadata.releaseChannel)) {
  throw new Error('DEPLOY_ENV must be local, staging, or production')
}

const temporaryPath = `${outputPath}.tmp-${process.pid}`
await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o644,
})
await rename(temporaryPath, outputPath)
console.log(`Generated ${path.relative(repositoryRoot, outputPath)}`)
