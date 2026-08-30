import type { CanonicalNap, JsonLdSnapshot } from './types'

const ALLOWED_TYPES = new Set(['LocalBusiness', 'Restaurant', 'CafeOrCoffeeShop', 'Store', 'MedicalBusiness', 'ProfessionalService'])

export interface LocalBusinessInput {
  nap: CanonicalNap
  schemaType?: string
  description?: string
  imageUrl?: string
  priceRange?: string
}

const validHttpUrl = (value: string): boolean => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

export function buildLocalBusinessJsonLd(input: LocalBusinessInput, generatedAt: string): JsonLdSnapshot {
  const schemaType = input.schemaType && ALLOWED_TYPES.has(input.schemaType) ? input.schemaType : 'LocalBusiness'
  const jsonLd: Record<string, unknown> = { '@context': 'https://schema.org', '@type': schemaType }
  if (input.nap.name.valid) jsonLd.name = input.nap.name.original.trim()
  if (input.nap.address.valid) jsonLd.address = { '@type': 'PostalAddress', streetAddress: input.nap.address.original.trim() }
  if (input.nap.phone.valid) jsonLd.telephone = input.nap.phone.canonical
  if (input.nap.url.valid) jsonLd.url = input.nap.url.canonical
  if (input.description?.trim()) jsonLd.description = input.description.trim()
  if (input.imageUrl && validHttpUrl(input.imageUrl)) jsonLd.image = input.imageUrl
  if (input.priceRange?.trim()) jsonLd.priceRange = input.priceRange.trim()
  return { version: 1, generatedAt, schemaType, jsonLd, serialized: serializeJsonLd(jsonLd) }
}

export function serializeJsonLd(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}
