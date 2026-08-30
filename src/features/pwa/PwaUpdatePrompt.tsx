import { useEffect, useState } from 'react'
import { useI18n } from '../../shared/i18n'
import { reloadOnServiceWorkerChange } from './pwa-update'

export function PwaUpdatePrompt() {
  const { text } = useI18n()
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const online = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  useEffect(() => {
    return reloadOnServiceWorkerChange(
      navigator.serviceWorker,
      () => window.location.reload(),
    )
  }, [])

  if (!isOnline) {
    return (
      <div className="connection-banner">
        {text({
          ja: 'オフラインです。入力内容を保持したまま接続をお待ちください。',
          en: "You're offline. We'll keep your input while you wait to reconnect.",
        })}
      </div>
    )
  }

  return null
}
