import { BarChart3, Building2, FileText, MessageSquareText, RadioTower, Store } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Locale } from '../../shared/i18n'
import { ownerStorePath } from '../owner/store-scope'

export const MEO_WORKSPACE_SECTIONS = [
  { id: 'profile', label: { ja: '店舗情報', en: 'Business profile' }, icon: Store },
  { id: 'reviews', label: { ja: '口コミ', en: 'Reviews' }, icon: MessageSquareText },
  { id: 'posts', label: { ja: '投稿', en: 'Posts' }, icon: FileText },
  { id: 'performance', label: { ja: '順位・インサイト', en: 'Rankings & insights' }, icon: BarChart3 },
  { id: 'aio', label: { ja: 'AIO', en: 'AIO' }, icon: RadioTower },
  { id: 'multistore', label: { ja: '多店舗・権限', en: 'Stores & access' }, icon: Building2 },
] as const satisfies readonly {
  id: string
  label: Readonly<Record<Locale, string>>
  icon: LucideIcon
}[]

export type MeoWorkspaceSectionId = (typeof MEO_WORKSPACE_SECTIONS)[number]['id']

export function meoWorkspacePath(storeId: string, section: MeoWorkspaceSectionId = 'profile'): string {
  return ownerStorePath(storeId, `/meo/workspace/${section}`)
}
