import { describe, expect, it } from 'vitest'
import {
  createInlineScriptSourceList,
  parseExactPublicOrigin,
  renderSecurityHeaders,
} from './generate-security-headers.mjs'

const template = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' __INLINE_SCRIPT_HASHES__; form-action 'self' __APP_ORIGIN__; connect-src 'self' __APP_ORIGIN__ __SUPABASE_ORIGIN__
`
const inlineScriptSourceList = "'sha256-test='"

describe('security header generation', () => {
  it('renders exact public origins and removes every placeholder', () => {
    const rendered = renderSecurityHeaders(
      template,
      {
        VITE_APP_ORIGIN: 'https://app.kuchitoru.com',
        VITE_SUPABASE_URL: 'https://project-ref.supabase.co',
      },
      inlineScriptSourceList,
    )

    expect(rendered).toContain('https://app.kuchitoru.com')
    expect(rendered).toContain('https://project-ref.supabase.co')
    expect(rendered).toContain(inlineScriptSourceList)
    expect(rendered).not.toMatch(/__(?:APP|SUPABASE)_ORIGIN__/)
    expect(rendered).not.toContain('__INLINE_SCRIPT_HASHES__')
    expect(rendered).not.toContain('Origin-Trial:')
    expect(rendered).not.toMatch(/SERVICE_ROLE|SECRET|OPENAI_API_KEY/)
  })

  it('creates CSP hashes for inline scripts and ignores external scripts', () => {
    const sourceList = createInlineScriptSourceList(
      '<script>window.theme = "dark"</script><script src="/app.js"></script>',
    )

    expect(sourceList).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/)
  })

  it('allows HTTP only for loopback development origins', () => {
    expect(parseExactPublicOrigin('http://127.0.0.1:56321', 'TEST_URL')).toBe(
      'http://127.0.0.1:56321',
    )
    expect(() =>
      parseExactPublicOrigin('http://app.kuchitoru.com', 'TEST_URL'),
    ).toThrow(/HTTPS/)
  })

  it.each([
    'https://user:password@app.kuchitoru.com',
    'https://app.kuchitoru.com/path',
    'https://app.kuchitoru.com?query=value',
    'https://app.kuchitoru.com#fragment',
  ])('rejects non-origin input %s', (value) => {
    expect(() => parseExactPublicOrigin(value, 'TEST_URL')).toThrow()
  })

  it('fails closed when the template is incomplete', () => {
    expect(() =>
      renderSecurityHeaders(
        '__SUPABASE_ORIGIN__',
        {
          VITE_APP_ORIGIN: 'https://app.kuchitoru.com',
          VITE_SUPABASE_URL: 'https://project-ref.supabase.co',
        },
        inlineScriptSourceList,
      ),
    ).toThrow(/__APP_ORIGIN__/)
  })

  it('blocks the local authenticated fixture from production builds', () => {
    expect(() =>
      renderSecurityHeaders(
        template,
        {
          VITE_APP_ORIGIN: 'https://app.kuchitoru.com',
          VITE_SUPABASE_URL: 'https://project-ref.supabase.co',
          VITE_E2E_TEST_MODE: '1',
        },
        inlineScriptSourceList,
      ),
    ).toThrow(/must never be enabled/)
  })
})
