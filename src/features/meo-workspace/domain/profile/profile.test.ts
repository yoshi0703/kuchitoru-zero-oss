import { describe, expect, it } from 'vitest'
import { createManualRestorePlan, diagnoseProfileCompleteness, diffProfileValues, normalizeProfile, profileSnapshotHashInput, serializeProfileSnapshot } from './index'
import type { ProfileInput } from './types'

const minimal = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({ title: '店舗', ...overrides })

describe('GBP profile domain', () => {
  it('normalizes whitespace and unordered fields into stable snapshots', () => {
    const first = minimal({ title: '  零   食堂 ', labels: [' 夜 ', '昼'], categories: [{ id: 'b' }, { id: 'a', primary: true }], attributes: [{ id: 'wifi', values: [' yes ', 'no'] }], providerFields: { z: ' x  y ', a: { d: 1, c: 2 } } })
    const second = minimal({ title: '零 食堂', labels: ['昼', '夜'], categories: [{ id: 'a', primary: true }, { id: 'b' }], attributes: [{ id: 'wifi', values: ['no', 'yes'] }], providerFields: { a: { c: 2, d: 1 }, z: 'x y' } })
    expect(normalizeProfile(first)).toEqual(normalizeProfile(second))
    expect(serializeProfileSnapshot(first)).toBe(serializeProfileSnapshot(second))
    expect(profileSnapshotHashInput(first)).toEqual(profileSnapshotHashInput(second))
  })

  it('keeps completeness scores within boundaries and covers every check family', () => {
    const empty = diagnoseProfileCompleteness(normalizeProfile(minimal({ title: '' })))
    const complete = diagnoseProfileCompleteness(normalizeProfile(minimal({ categories: [{ id: 'restaurant', primary: true }], storefrontAddress: { countryCode: 'jp', addressLines: ['東京都'] }, regularHours: [{ openDay: 'MONDAY', openTime: '09:00', closeTime: '18:00' }], phone: '03-0000-0000', website: 'https://example.test', description: '地域の皆さまに毎日おいしい料理と心地よい時間をお届けする、素材と手作りにこだわったレストランです。お気軽にお越しください。', attributes: [{ id: 'wifi', values: [true] }], paymentOptions: { cash: true } })))
    expect(empty.score).toBe(0)
    expect(complete.score).toBe(100)
    expect(new Set(empty.checks.map((check) => check.family))).toEqual(new Set(['identity', 'location', 'hours', 'contact', 'discovery', 'facilities']))
    expect(empty.checks.every((check) => check.message.length > 0 && check.action.length > 0)).toBe(true)
  })

  it('localizes completeness presentation without changing deterministic diagnostics or source data', () => {
    const profile = normalizeProfile(minimal({ title: 'Tokyo 食堂', storefrontAddress: { countryCode: 'jp', addressLines: ['東京都 Chiyoda'] }, description: '地域の味を届ける neighborhood restaurant' }))
    const sourceBeforeDiagnosis = structuredClone(profile)
    const japanese = diagnoseProfileCompleteness(profile)
    const explicitJapanese = diagnoseProfileCompleteness(profile, 'ja')
    const english = diagnoseProfileCompleteness(profile, 'en')
    const diagnosticFields = (diagnosis: typeof japanese) => diagnosis.checks.map(({ id, family, severity, weight, complete }) => ({ id, family, severity, weight, complete }))

    expect(japanese).toEqual(explicitJapanese)
    expect(english.score).toBe(japanese.score)
    expect(diagnosticFields(english)).toEqual(diagnosticFields(japanese))
    expect(english.checks.map(({ message, action }) => [message, action])).toEqual([
      ['Business name is missing', 'Enter the official business name.'],
      ['Primary category is missing', 'Select the primary category that best describes the business.'],
      ['Address or service area is missing', 'Set a storefront address or service area.'],
      ['Regular hours are missing', 'Add regular hours for each day of the week.'],
      ['Phone number is missing', 'Add a phone number that customers can use to contact the business.'],
      ['Website is missing', 'Add the official website URL.'],
      ['Business description is incomplete', 'Add a description of at least 50 characters that highlights the business.'],
      ['Attributes are missing', 'Select the available facility and service attributes.'],
      ['Facility and payment information is missing', 'Review service, accessibility, facility, and payment options.'],
    ])
    expect(japanese.checks[0]).toMatchObject({ message: '店舗名が未設定です', action: '正式な店舗名を入力してください。' })
    expect(profile).toEqual(sourceBeforeDiagnosis)
    expect(profile).toMatchObject({ title: 'Tokyo 食堂', storefrontAddress: { addressLines: ['東京都 Chiyoda'] }, description: '地域の味を届ける neighborhood restaurant' })
  })

  it('produces deep add, remove, and change entries for nested arrays and objects', () => {
    expect(diffProfileValues({ nested: [{ name: 'old' }], removed: true }, { nested: [{ name: 'new' }, 2], added: 'yes' })).toEqual([
      { kind: 'add', path: '/added', after: 'yes' },
      { kind: 'change', path: '/nested/0/name', before: 'old', after: 'new' },
      { kind: 'add', path: '/nested/1', after: 2 },
      { kind: 'remove', path: '/removed', before: true },
    ])
  })

  it('builds a manual plan while excluding provider-managed fields', () => {
    const plan = createManualRestorePlan(
      minimal({ title: '現在', coordinates: { latitude: 1, longitude: 2 }, metadata: { placeId: 'current' }, providerFields: { opaque: 'current' } }),
      minimal({ title: '復元先', phone: '123', coordinates: { latitude: 3, longitude: 4 }, metadata: { placeId: 'target' }, providerFields: { opaque: 'target' } }),
    )
    expect(plan.operations).toEqual(expect.arrayContaining([{ action: 'set', path: '/title', value: '復元先' }, { action: 'set', path: '/phone', value: '123' }]))
    expect(plan.excluded.map((item) => item.path)).toEqual(expect.arrayContaining(['/coordinates/latitude', '/coordinates/longitude', '/metadata/placeId', '/providerFields/opaque']))
    expect(plan.operations.every((item) => !/^\/(coordinates|metadata|providerFields)(\/|$)/u.test(item.path))).toBe(true)
  })
})
