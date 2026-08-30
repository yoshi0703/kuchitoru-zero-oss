import { describe, expect, it } from 'vitest'
import { createCsv, sanitizeCsvCell } from './csv'

describe('sanitizeCsvCell', () => {
  it.each(['=1+1', '+cmd', '-2+3', '@sum', '\tformula', '\rformula', '  =1+1'])(
    'neutralizes spreadsheet formula input %s',
    (value) => expect(sanitizeCsvCell(value).replace(/^"/, '').startsWith("'")).toBe(true),
  )

  it('returns a complete RFC4180 cell', () => {
    expect(sanitizeCsvCell('a,"b"\r\nc')).toBe('"a,""b""\r\nc"')
  })

  it('creates a BOM-prefixed CRLF document', () => {
    expect(createCsv([['見出し'], ['値']])).toBe('\uFEFF見出し\r\n値\r\n')
  })
})
