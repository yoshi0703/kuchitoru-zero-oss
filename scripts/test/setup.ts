import * as matchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'

expect.extend(matchers)

if (!('IntersectionObserver' in globalThis)) {
  class TestIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]

    constructor(private readonly callback: IntersectionObserverCallback) {}

    disconnect() {}

    observe(target: Element) {
      this.callback([
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          isVisible: true,
          rootBounds: null,
          target,
          time: Date.now(),
        } as IntersectionObserverEntry,
      ], this)
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }

    unobserve() {}
  }

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: TestIntersectionObserver,
  })
}

if (!('ResizeObserver' in globalThis)) {
  class TestResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    disconnect() {}

    observe(target: Element) {
      const rect = target.getBoundingClientRect()
      this.callback([
        {
          target,
          contentRect: new DOMRect(0, 0, rect.width, rect.height || 20),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry,
      ], this)
    }

    unobserve() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })
}

const nativeFetch = globalThis.fetch
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])

function requestedUrl(input: RequestInfo | URL): URL | null {
  if (input instanceof URL) {
    return input
  }

  if (typeof input === 'string') {
    try {
      return new URL(input, 'http://localhost')
    } catch {
      return null
    }
  }

  try {
    return new URL(input.url)
  } catch {
    return null
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestedUrl(input)

      if (
        url &&
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !loopbackHosts.has(url.hostname)
      ) {
        throw new Error(
          `External network access is disabled in tests (${url.origin})`,
        )
      }

      return nativeFetch(input, init)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
