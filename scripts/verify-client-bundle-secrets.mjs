import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultBundleDirectory = path.join(repositoryRoot, 'dist')
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
])

const namedSecretRules = [
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI API key', /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ['xAI API key', /\bxai-[A-Za-z0-9_-]{20,}/g],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{30,}/g],
  ['private key material', /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/g],
  [
    'server-only environment name',
    /\b(?:AI_CREDENTIALS_MASTER_KEY_V\d+|ANTHROPIC_API_KEY|DATAFORSEO_LOGIN|DATAFORSEO_PASSWORD|DEEPSEEK_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_BUSINESS_CLIENT_SECRET|INSTAGRAM_APP_SECRET|OPENAI_API_KEY|RATE_LIMIT_HMAC_KEY|SUPABASE_SERVICE_ROLE_KEY|TURNSTILE_SECRET_KEY|XAI_API_KEY)\b/g,
  ],
]

function containsServiceRoleJwt(text) {
  const jwtCandidates = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []

  return jwtCandidates.some((candidate) => {
    try {
      const payload = candidate.split('.')[1]
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      return decoded?.role === 'service_role'
    } catch {
      return false
    }
  })
}

export function scanBundleText(text) {
  const findingLabels = namedSecretRules
    .filter(([, expression]) => {
      expression.lastIndex = 0
      return expression.test(text)
    })
    .map(([label]) => label)

  if (containsServiceRoleJwt(text)) {
    findingLabels.push('Supabase service_role JWT')
  }

  return [...new Set(findingLabels)]
}

async function listTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return listTextFiles(absolutePath)
      }
      if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
        return [absolutePath]
      }
      return []
    }),
  )
  return nested.flat()
}

export async function scanClientBundle(
  directory = defaultBundleDirectory,
  { allowSourceMaps = process.env.ALLOW_PUBLIC_SOURCEMAPS === '1' } = {},
) {
  let bundleStat
  try {
    bundleStat = await stat(directory)
  } catch {
    throw new Error(`Client bundle directory does not exist: ${directory}`)
  }

  if (!bundleStat.isDirectory()) {
    throw new Error(`Client bundle path is not a directory: ${directory}`)
  }

  const findings = []
  const files = await listTextFiles(directory)

  for (const file of files) {
    if (!allowSourceMaps && path.extname(file) === '.map') {
      findings.push({ file, label: 'public source map is disabled by policy' })
    }

    const text = await readFile(file, 'utf8')
    for (const label of scanBundleText(text)) {
      findings.push({ file, label })
    }
  }

  return findings
}

async function main() {
  const directory = process.argv[2]
    ? path.resolve(process.argv[2])
    : defaultBundleDirectory
  const findings = await scanClientBundle(directory)

  if (findings.length > 0) {
    console.error('Client bundle secret scan failed:')
    for (const finding of findings) {
      console.error(`- ${path.relative(repositoryRoot, finding.file)}: ${finding.label}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Client bundle secret scan passed (${path.relative(repositoryRoot, directory)})`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
