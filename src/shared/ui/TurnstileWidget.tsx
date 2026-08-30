import { useEffect, useRef } from 'react'
import { runtimeConfig } from '../config/runtime'
import { useI18n } from '../i18n'
import { Notice } from './ui'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

export function TurnstileWidget({
  action,
  onToken,
}: {
  action: string
  onToken: (token: string) => void
}) {
  const { text } = useI18n()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (runtimeConfig.isE2ETestMode) {
      onToken('e2e-turnstile-token')
      return
    }
    if (!runtimeConfig.turnstileSiteKey || !ref.current) return

    let widgetId = ''
    let script = document.querySelector<HTMLScriptElement>('script[data-kuchitoru-turnstile]')
    const render = () => {
      if (widgetId || !window.turnstile || !ref.current) return
      widgetId = window.turnstile.render(ref.current, {
        sitekey: runtimeConfig.turnstileSiteKey,
        action,
        appearance: 'interaction-only',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      })
    }

    if (script && window.turnstile) render()
    else if (script) script.addEventListener('load', render, { once: true })
    else {
      script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.kuchitoruTurnstile = 'true'
      script.addEventListener('load', render, { once: true })
      document.head.append(script)
    }

    return () => {
      script?.removeEventListener('load', render)
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [action, onToken])

  if (!runtimeConfig.isE2ETestMode && !runtimeConfig.turnstileSiteKey) {
    return <Notice tone="error">{text({ ja: 'セキュリティ確認を読み込めませんでした。', en: 'Could not load the security check.' })}</Notice>
  }
  return <div className="turnstile-box" ref={ref} aria-label={text({ ja: 'セキュリティ確認', en: 'Security check' })} />
}
