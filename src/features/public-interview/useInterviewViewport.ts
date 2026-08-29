import { useEffect } from 'react'

export function useInterviewViewport(active: boolean) {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    const body = document.body
    root.dataset.interviewActive = 'true'
    root.classList.add('interview-viewport-locked')
    body.classList.add('interview-viewport-locked')

    let focusScrollFrame: number | undefined
    const keepFocusedFieldVisible = () => {
      const focused = document.activeElement
      if (!(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) return
      if (focusScrollFrame !== undefined) window.cancelAnimationFrame(focusScrollFrame)
      focusScrollFrame = window.requestAnimationFrame(() => {
        focused.scrollIntoView({ block: 'center', inline: 'nearest' })
      })
    }

    const update = () => {
      const viewport = window.visualViewport
      root.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`)
      root.style.setProperty('--app-width', `${viewport?.width ?? window.innerWidth}px`)
      root.style.setProperty('--visual-viewport-offset-top', `${viewport?.offsetTop ?? 0}px`)
      root.style.setProperty('--visual-viewport-offset-left', `${viewport?.offsetLeft ?? 0}px`)
      keepFocusedFieldVisible()
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', keepFocusedFieldVisible)
    return () => {
      delete root.dataset.interviewActive
      root.classList.remove('interview-viewport-locked')
      body.classList.remove('interview-viewport-locked')
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', keepFocusedFieldVisible)
      if (focusScrollFrame !== undefined) window.cancelAnimationFrame(focusScrollFrame)
    }
  }, [active])
}
