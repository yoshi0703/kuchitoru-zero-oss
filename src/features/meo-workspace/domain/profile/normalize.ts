import type { GbpLocationProfile, JsonValue, ProfileAttribute, ProfileInput, TimePeriod } from './types'

const text = (value: string): string => value.trim().replace(/\s+/gu, ' ')
const optionalText = (value: string | undefined): string | undefined => value === undefined || text(value) === '' ? undefined : text(value)
const optionalString = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> => {
  const normalized = optionalText(value)
  return normalized === undefined ? {} : { [key]: normalized } as Record<K, string>
}
const sortedRecord = (value: Readonly<Record<string, boolean>> | undefined): Record<string, boolean> => Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)))

export const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalizeJson(item)]))
  return typeof value === 'string' ? text(value) : value
}

const normalizeHours = (period: TimePeriod): TimePeriod => ({
  openDay: text(period.openDay).toUpperCase(), openTime: text(period.openTime),
  ...(period.closeDay === undefined ? {} : { closeDay: text(period.closeDay).toUpperCase() }), closeTime: text(period.closeTime),
})

const normalizeAttribute = (attribute: ProfileAttribute): ProfileAttribute => ({ id: text(attribute.id), values: [...new Set(attribute.values.map((value) => typeof value === 'string' ? text(value) : value))].sort((a, b) => String(a).localeCompare(String(b))) })
const normalizeCategory = (category: NonNullable<ProfileInput['categories']>[number]) => {
  const displayName = optionalText(category.displayName)
  return { id: text(category.id), ...(displayName === undefined ? {} : { displayName }), ...(category.primary === undefined ? {} : { primary: category.primary }) }
}

export const normalizeProfile = (input: ProfileInput): GbpLocationProfile => ({
  title: text(input.title),
  ...optionalString('storeCode', input.storeCode),
  categories: (input.categories ?? []).map(normalizeCategory).sort((a, b) => a.id.localeCompare(b.id)),
  ...(input.storefrontAddress === undefined ? {} : { storefrontAddress: { countryCode: text(input.storefrontAddress.countryCode).toUpperCase(), ...optionalString('postalCode', input.storefrontAddress.postalCode), ...optionalString('administrativeArea', input.storefrontAddress.administrativeArea), ...optionalString('locality', input.storefrontAddress.locality), ...optionalString('sublocality', input.storefrontAddress.sublocality), addressLines: input.storefrontAddress.addressLines.map(text).filter(Boolean) } }),
  ...(input.serviceArea === undefined ? {} : { serviceArea: { businessType: input.serviceArea.businessType, ...(input.serviceArea.regionCode === undefined ? {} : { regionCode: text(input.serviceArea.regionCode).toUpperCase() }), ...(input.serviceArea.places === undefined ? {} : { places: [...new Set(input.serviceArea.places.map(text).filter(Boolean))].sort() }) } }),
  regularHours: (input.regularHours ?? []).map(normalizeHours).sort((a, b) => `${a.openDay}-${a.openTime}-${a.closeTime}`.localeCompare(`${b.openDay}-${b.openTime}-${b.closeTime}`)),
  specialHours: (input.specialHours ?? []).map((period) => ({ startDate: text(period.startDate), ...(period.endDate === undefined ? {} : { endDate: text(period.endDate) }), ...(period.closed === undefined ? {} : { closed: period.closed }), ...(period.openTime === undefined ? {} : { openTime: text(period.openTime) }), ...(period.closeTime === undefined ? {} : { closeTime: text(period.closeTime) }) })).sort((a, b) => a.startDate.localeCompare(b.startDate)),
  ...optionalString('phone', input.phone), ...optionalString('website', input.website),
  attributes: (input.attributes ?? []).map(normalizeAttribute).sort((a, b) => a.id.localeCompare(b.id)),
  serviceOptions: sortedRecord(input.serviceOptions), accessibility: sortedRecord(input.accessibility), amenities: sortedRecord(input.amenities), paymentOptions: sortedRecord(input.paymentOptions),
  ...optionalString('description', input.description), ...optionalString('openingDate', input.openingDate),
  labels: [...new Set((input.labels ?? []).map(text).filter(Boolean))].sort(),
  ...(input.coordinates === undefined ? {} : { coordinates: { latitude: input.coordinates.latitude, longitude: input.coordinates.longitude } }),
  ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  providerFields: canonicalizeJson(input.providerFields ?? {}) as Record<string, JsonValue>,
})
