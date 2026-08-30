import { spawnSync } from 'node:child_process'

const result = spawnSync(
  'corepack',
  ['pnpm', 'licenses', 'list', '--prod', '--json'],
  { encoding: 'utf8' },
)

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}

const report = JSON.parse(result.stdout)
const allowed = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT', 'OFL-1.1'])
const rejected = Object.keys(report).filter((license) => !allowed.has(license))

if (rejected.length > 0) {
  console.error(`Unreviewed production dependency licenses: ${rejected.join(', ')}`)
  process.exit(1)
}

const packageCount = Object.values(report)
  .flat()
  .reduce((count, item) => count + item.versions.length, 0)
console.log(`Reviewed ${packageCount} production dependency versions across ${Object.keys(report).length} licenses.`)
