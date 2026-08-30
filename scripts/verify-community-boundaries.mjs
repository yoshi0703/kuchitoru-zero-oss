import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const listed = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
if (listed.status !== 0) {
  process.stderr.write(listed.stderr)
  process.exit(listed.status ?? 1)
}

const files = listed.stdout
  .split('\n')
  .filter(Boolean)

const forbidden = [
  ['Stripe implementation', /(?:\bSTRIPE_[A-Z_]+\b|from\s+['"]stripe['"]|['"]stripe['"]\s*:|stripe[-_/](?:checkout|webhook|billing)|\/stripe\b)/i],
  ['automatic charging', /auto[-_ ]?charge/i],
  ['survey credits', /survey_credit/i],
  ['Zero credits', /zero_credits/i],
  ['platform AI', /platform[-_ ]?ai/i],
  ['platform credit mode', /platform_credit/i],
  ['feature unlock purchases', /feature_unlock/i],
  ['partner data provision', /partner_data_provision/i],
  ['billing API', /billingMode|AiCreditStatus/],
  ['credit environment flag', /VITE_AI_CREDITS/i],
  ['fixed external GPT', /chatgpt\.com\/g\//i],
  ['MEO heatmap', /heatmap/i],
  ['legacy AI encryption secret', /\bAI_CREDENTIAL_MASTER_KEY\b/],
  ['legacy interview token secret', /\bPUBLIC_INTERVIEW_TOKEN_PEPPER\b/],
  ['Hosted AI quota state', /\b(?:ai_quota_state|ai_quota_period_start|interview_monthly_usage|monthly_ai_generation_limit|monthly_session_start_limit|remaining_this_month|remainingThisMonth|remainingAiGenerations)\b/],
  ['Hosted quota error', /\b(?:MONTHLY_QUOTA_EXCEEDED|MONTHLY_SESSION_LIMIT_EXCEEDED|STORE_LIMIT_REACHED)\b/],
  ['Hosted entitlement table', /\b(?:store_entitlements|free_alpha|active_store_limit)\b/],
  ['Kuchitoru AI usage ledger', /\b(?:ai_usage_events|internal_record_ai_usage|recordAiUsage)\b/],
  ['Hosted provider usage settlement', /\bPROVIDER_USAGE_SETTLEMENT_FAILED\b/],
  ['Hosted contact relay', /\bcontact-submit\b|info@kuchitoru\.com/i],
  ['Hosted legal gate', /\b(?:legal-status|legalRelease|legal_acceptance|owner_legal)\b/i],
  ['Hosted email delivery', /\bRESEND_API_KEY\b|from\s+['"]resend['"]/i],
  ['Hosted store allowance copy', /100店舗/],
]

const violations = []
const governanceContactFiles = new Set([
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'SUPPORT.md',
  'TRADEMARKS.md',
])
for (const file of files.filter((candidate) =>
  candidate !== 'scripts/verify-community-boundaries.mjs' &&
  !candidate.startsWith('.github/')
)) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const [label, pattern] of forbidden) {
    if (label === 'Hosted contact relay' && governanceContactFiles.has(file)) continue
    if (pattern.test(file) || pattern.test(content)) violations.push(`${file}: ${label}`)
  }
  if (/shigureni/i.test(file)) violations.push(`${file}: unlicensed Shigureni asset`)
}

for (const workflow of files.filter((file) => file.startsWith('.github/workflows/'))) {
  const content = readFileSync(workflow, 'utf8')
  for (const [index, line] of content.split('\n').entries()) {
    if (/^\s*-?\s*uses:\s*/.test(line) && !/@[0-9a-f]{40}(?:\s|#|$)/i.test(line)) {
      violations.push(`${workflow}:${index + 1}: GitHub Action is not pinned to a commit SHA`)
    }
  }
}

if (violations.length > 0) {
  console.error('Community distribution boundary check failed:')
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Community distribution boundary check passed for ${files.length} files.`)
