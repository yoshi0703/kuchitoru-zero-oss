import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  scanBundleText,
  scanClientBundle,
} from './verify-client-bundle-secrets.mjs'

function serviceRoleJwt() {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role' })}.fixture-signature`
}

describe('client bundle secret scanner', () => {
  it('allows explicitly public browser configuration', () => {
    expect(
      scanBundleText(
        'VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_TURNSTILE_SITE_KEY sb_publishable_test',
      ),
    ).toEqual([])
  })

  it.each([
    ['Anthropic API key', `sk-ant-${'d'.repeat(32)}`],
    ['OpenAI API key', `sk-proj-${'a'.repeat(32)}`],
    ['xAI API key', `xai-${'c'.repeat(32)}`],
    ['Google API key', `AIza${'b'.repeat(35)}`],
    ['private key material', '-----BEGIN PRIVATE KEY-----'],
    ['server-only environment name', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['server-only environment name', 'ANTHROPIC_API_KEY'],
    ['server-only environment name', 'DEEPSEEK_API_KEY'],
    ['server-only environment name', 'XAI_API_KEY'],
    ['Supabase service_role JWT', serviceRoleJwt()],
  ])('detects %s without returning the matched value', (label, secret) => {
    const findings = scanBundleText(`window.fixture = ${JSON.stringify(secret)}`)
    expect(findings).toContain(label)
    expect(findings.join(' ')).not.toContain(secret)
  })

  it('classifies an Anthropic key without mislabeling it as OpenAI', () => {
    expect(scanBundleText(`sk-ant-${'d'.repeat(32)}`)).toEqual([
      'Anthropic API key',
    ])
  })

  it('rejects source maps by default', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kuchitoru-bundle-'))
    const dist = path.join(temporaryRoot, 'dist')
    await mkdir(dist)
    await writeFile(path.join(dist, 'app.js'), 'console.log("public")')
    await writeFile(path.join(dist, 'app.js.map'), '{}')

    await expect(scanClientBundle(dist)).resolves.toEqual([
      expect.objectContaining({ label: 'public source map is disabled by policy' }),
    ])
  })
})
