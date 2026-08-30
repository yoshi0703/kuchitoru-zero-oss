import { useQuery } from '@tanstack/react-query'
import { useActiveStoreId } from '../owner/store-scope'
import { getMeoWorkspaceSnapshot } from './meo-workspace-api'

export function useMeoWorkspace() {
  const storeId = useActiveStoreId()
  const query = useQuery({
    queryKey: ['meo-workspace', storeId],
    queryFn: ({ signal }) => getMeoWorkspaceSnapshot(storeId, signal),
    staleTime: 30_000,
  })
  return { storeId, query, authorization: query.data?.authorization }
}
