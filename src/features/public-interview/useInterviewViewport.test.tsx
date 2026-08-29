import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInterviewViewport } from './useInterviewViewport'

function Harness() {
  useInterviewViewport(true)
  return <textarea aria-label="回答" />
}

describe('useInterviewViewport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the focused answer visible after the visual viewport resizes', () => {
    const listeners = new Map<string, EventListener>()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 390,
        height: 420,
        offsetTop: 0,
        offsetLeft: 0,
        addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
        removeEventListener: vi.fn(),
      },
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const { getByLabelText } = render(<Harness />)
    const textarea = getByLabelText('回答')
    textarea.focus()
    scrollIntoView.mockClear()

    act(() => listeners.get('resize')?.(new Event('resize')))

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('420px')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })
})
