import { useParams } from 'react-router'

const STORE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function useActiveStoreId(): string
export function useActiveStoreId(options: { optional: true }): string | undefined
export function useActiveStoreId(options?: { optional?: boolean }): string | undefined {
  const { storeId } = useParams<{ storeId: string }>()
  if (!storeId && options?.optional) return undefined
  if (!storeId || !STORE_ID_PATTERN.test(storeId)) {
    throw new Error('INVALID_STORE_ID')
  }
  return storeId
}

export function ownerStorePath(storeId: string, suffix = ''): string {
  return `/dashboard/stores/${storeId}${suffix}`
}

export function ownerStoreSwitchPath(
  pathname: string,
  currentStoreId: string,
  nextStoreId: string,
): string {
  const currentBasePath = ownerStorePath(currentStoreId)
  const nextBasePath = ownerStorePath(nextStoreId)

  if (pathname.startsWith(`${currentBasePath}/interviews/`)) {
    return `${nextBasePath}/interviews`
  }

  return pathname.replace(currentBasePath, nextBasePath)
}

export function isScopedRouteActive(to: string, pathname: string, exact = false): boolean {
  if (exact) return pathname === to
  return pathname === to || pathname.startsWith(`${to}/`)
}
