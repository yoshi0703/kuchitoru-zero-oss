export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

export interface Category { readonly id: string; readonly displayName?: string; readonly primary?: boolean }
export interface Address { readonly countryCode: string; readonly postalCode?: string; readonly administrativeArea?: string; readonly locality?: string; readonly sublocality?: string; readonly addressLines: readonly string[] }
export interface ServiceArea { readonly businessType: 'CUSTOMER_LOCATION_ONLY' | 'CUSTOMER_AND_BUSINESS_LOCATION'; readonly places?: readonly string[]; readonly regionCode?: string }
export interface TimePeriod { readonly openDay: string; readonly openTime: string; readonly closeDay?: string; readonly closeTime: string }
export interface SpecialHoursPeriod { readonly startDate: string; readonly endDate?: string; readonly closed?: boolean; readonly openTime?: string; readonly closeTime?: string }
export interface ProfileAttribute { readonly id: string; readonly values: readonly (string | boolean)[] }
export interface Coordinates { readonly latitude: number; readonly longitude: number }
export interface ProfileMetadata { readonly placeId?: string; readonly mapsUri?: string; readonly newReviewUri?: string; readonly duplicateLocation?: string; readonly canDelete?: boolean; readonly canOperateLocalPost?: boolean }

export interface GbpLocationProfile {
  readonly title: string
  readonly storeCode?: string
  readonly categories: readonly Category[]
  readonly storefrontAddress?: Address
  readonly serviceArea?: ServiceArea
  readonly regularHours: readonly TimePeriod[]
  readonly specialHours: readonly SpecialHoursPeriod[]
  readonly phone?: string
  readonly website?: string
  readonly attributes: readonly ProfileAttribute[]
  readonly serviceOptions: Readonly<Record<string, boolean>>
  readonly accessibility: Readonly<Record<string, boolean>>
  readonly amenities: Readonly<Record<string, boolean>>
  readonly paymentOptions: Readonly<Record<string, boolean>>
  readonly description?: string
  readonly openingDate?: string
  readonly labels: readonly string[]
  readonly coordinates?: Coordinates
  readonly metadata?: ProfileMetadata
  /** Provider extensions are retained for round-tripping, but are never writable. */
  readonly providerFields: Readonly<Record<string, JsonValue>>
}

export type ProfileInput = Partial<GbpLocationProfile> & Pick<GbpLocationProfile, 'title'>
