import { runtimeConfig } from '../../shared/config/runtime'

const DEFAULT_RETURN_PATH = '/dashboard'

function hasEncodedOrLiteralBackslash(rawPath: string): boolean {
  let value = rawPath

  for (let index = 0; index < 3; index += 1) {
    if (value.includes('\\')) return true

    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) return false
      value = decoded
    } catch {
      return true
    }
  }

  return value.includes('\\')
}

function isAllowedReturnPath(pathname: string): boolean {
  return pathname === '/account'
    || pathname === '/dashboard'
    || pathname.startsWith('/dashboard/')
}

export function safeReturnPath(
  raw: string | null,
  appOrigin = runtimeConfig.appOrigin,
): string {
  if (!raw) return DEFAULT_RETURN_PATH

  const rawPath = raw.split(/[?#]/, 1)[0] ?? ''
  if (hasEncodedOrLiteralBackslash(rawPath)) return DEFAULT_RETURN_PATH

  try {
    const appUrl = new URL(appOrigin)
    const target = new URL(raw, appUrl.origin)

    if (target.origin !== appUrl.origin || !isAllowedReturnPath(target.pathname)) {
      return DEFAULT_RETURN_PATH
    }

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return DEFAULT_RETURN_PATH
  }
}
