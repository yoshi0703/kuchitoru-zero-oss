import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation, useParams } from 'react-router'
import { LoadingState } from '../../shared/ui/ui'
import { useI18n } from '../../shared/i18n'
import { getOwnerStores } from './owner-api'
import { ownerStorePath } from './store-scope'

type LegacyOwnerRouteRedirectProps = {
  suffix: string
  includeLegacyId?: boolean
}

export function LegacyOwnerRouteRedirect({ suffix, includeLegacyId = false }: LegacyOwnerRouteRedirectProps) {
  const { text } = useI18n()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const storesQuery = useQuery({
    queryKey: ['owner-stores'],
    queryFn: getOwnerStores,
  })

  if (storesQuery.isLoading) return <LoadingState label={text({ ja: '店舗情報を確認しています', en: 'Checking store information' })} />

  const stores = storesQuery.data ?? []
  const store = stores.find((candidate) => candidate.owner_store_slot === 1)
    ?? [...stores].sort((left, right) => left.owner_store_slot - right.owner_store_slot)[0]

  if (storesQuery.isError || !store) return <Navigate to="/dashboard" replace />

  return (
    <Navigate
      to={`${ownerStorePath(store.id, `${suffix}${includeLegacyId && id ? `/${id}` : ''}`)}${location.search}${location.hash}`}
      replace
    />
  )
}
