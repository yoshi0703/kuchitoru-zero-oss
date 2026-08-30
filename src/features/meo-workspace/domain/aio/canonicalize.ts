import type { CanonicalField, CanonicalNap } from './types'

const normalizeText = (value: string): string =>
  value.normalize('NFKC').trim().replace(/[\s\u3000]+/g, ' ')

export function canonicalizeName(original: string): CanonicalField {
  const normalized = normalizeText(original)
  return {
    original,
    canonical: normalized.toLocaleLowerCase('ja-JP').replace(/[\s・･,.，。'’"“”]/g, ''),
    valid: normalized.length > 0,
  }
}

export function canonicalizeAddress(original: string): CanonicalField {
  const normalized = normalizeText(original)
    .replace(/^〒\s*\d{3}-?\d{4}\s*/, '')
    .replace(/([0-9])\s*(?:丁目|番地|番|号)\s*/g, '$1-')
    .replace(/-+/g, '-')
    .replace(/-$/, '')
  return {
    original,
    canonical: normalized.replace(/[\s,，]/g, '').toLocaleLowerCase('ja-JP'),
    valid: normalized.length > 0,
  }
}

export function canonicalizePhone(original: string): CanonicalField {
  let digits = original.normalize('NFKC').replace(/[^0-9+]/g, '')
  if (digits.startsWith('+81')) digits = `0${digits.slice(3)}`
  const canonical = digits.replace(/\D/g, '')
  return { original, canonical, valid: /^0\d{9,10}$/.test(canonical) }
}

export function canonicalizeUrl(original: string): CanonicalField {
  const normalized = normalizeText(original)
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    const params = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
    parsed.search = ''
    for (const [key, value] of params) parsed.searchParams.append(key, value)
    const canonical = parsed.toString().replace(/\/$/, '')
    return { original, canonical, valid: true }
  } catch {
    return { original, canonical: normalized.toLowerCase(), valid: false }
  }
}

export function canonicalizeNap(input: {
  name: string
  address: string
  phone: string
  url: string
}): CanonicalNap {
  return {
    name: canonicalizeName(input.name),
    address: canonicalizeAddress(input.address),
    phone: canonicalizePhone(input.phone),
    url: canonicalizeUrl(input.url),
  }
}
