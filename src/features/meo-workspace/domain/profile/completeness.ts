import type { GbpLocationProfile } from './types'
import type { Locale } from '../../../../shared/i18n'

export type CompletenessSeverity = 'error' | 'warning' | 'info'
export type CompletenessFamily = 'identity' | 'location' | 'hours' | 'contact' | 'discovery' | 'facilities'
export interface CompletenessCheck { readonly id: string; readonly family: CompletenessFamily; readonly severity: CompletenessSeverity; readonly weight: number; readonly complete: boolean; readonly message: string; readonly action: string }
export interface CompletenessDiagnosis { readonly score: number; readonly checks: readonly CompletenessCheck[] }

export const diagnoseProfileCompleteness = (profile: GbpLocationProfile, locale: Locale = 'ja'): CompletenessDiagnosis => {
  const check = (id: string, family: CompletenessFamily, severity: CompletenessSeverity, weight: number, complete: boolean, message: string, action: string): CompletenessCheck => ({ id, family, severity, weight, complete, message, action })
  const copy = locale === 'en' ? ({
    title: ['Business name is missing', 'Enter the official business name.'],
    primaryCategory: ['Primary category is missing', 'Select the primary category that best describes the business.'],
    location: ['Address or service area is missing', 'Set a storefront address or service area.'],
    hours: ['Regular hours are missing', 'Add regular hours for each day of the week.'],
    phone: ['Phone number is missing', 'Add a phone number that customers can use to contact the business.'],
    website: ['Website is missing', 'Add the official website URL.'],
    description: ['Business description is incomplete', 'Add a description of at least 50 characters that highlights the business.'],
    attributes: ['Attributes are missing', 'Select the available facility and service attributes.'],
    options: ['Facility and payment information is missing', 'Review service, accessibility, facility, and payment options.'],
  } as const) : ({
    title: ['店舗名が未設定です', '正式な店舗名を入力してください。'],
    primaryCategory: ['メインカテゴリが未設定です', '事業を最もよく表すメインカテゴリを選択してください。'],
    location: ['住所またはサービス提供地域が未設定です', '来店先住所またはサービス提供地域を設定してください。'],
    hours: ['通常営業時間が未設定です', '曜日ごとの通常営業時間を追加してください。'],
    phone: ['電話番号が未設定です', '顧客が連絡できる電話番号を追加してください。'],
    website: ['ウェブサイトが未設定です', '公式ウェブサイトのURLを追加してください。'],
    description: ['ビジネス説明が不足しています', '特徴が伝わる50文字以上の説明を追加してください。'],
    attributes: ['属性が未設定です', '利用可能な設備やサービス属性を選択してください。'],
    options: ['設備・決済情報が未設定です', 'サービス、バリアフリー、設備、決済方法を確認してください。'],
  } as const)
  const checks = [
    check('title', 'identity', 'error', 15, profile.title.length > 0, copy.title[0], copy.title[1]),
    check('primary-category', 'identity', 'error', 15, profile.categories.some((item) => item.primary), copy.primaryCategory[0], copy.primaryCategory[1]),
    check('location', 'location', 'error', 15, profile.storefrontAddress !== undefined || profile.serviceArea !== undefined, copy.location[0], copy.location[1]),
    check('hours', 'hours', 'warning', 15, profile.regularHours.length > 0, copy.hours[0], copy.hours[1]),
    check('phone', 'contact', 'warning', 10, Boolean(profile.phone), copy.phone[0], copy.phone[1]),
    check('website', 'contact', 'warning', 10, Boolean(profile.website), copy.website[0], copy.website[1]),
    check('description', 'discovery', 'info', 10, (profile.description?.length ?? 0) >= 50, copy.description[0], copy.description[1]),
    check('attributes', 'facilities', 'info', 5, profile.attributes.length > 0, copy.attributes[0], copy.attributes[1]),
    check('options', 'facilities', 'info', 5, [profile.serviceOptions, profile.accessibility, profile.amenities, profile.paymentOptions].some((item) => Object.keys(item).length > 0), copy.options[0], copy.options[1]),
  ]
  const earned = checks.reduce((sum, item) => sum + (item.complete ? item.weight : 0), 0)
  const total = checks.reduce((sum, item) => sum + item.weight, 0)
  return { score: Math.max(0, Math.min(100, Math.round(earned / total * 100))), checks }
}
