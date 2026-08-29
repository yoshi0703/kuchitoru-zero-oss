import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, LOCALE_STORAGE_KEY, type Locale } from '../../shared/i18n'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'
import { reloadOnServiceWorkerChange } from './pwa-update'

function renderPrompt(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(<I18nProvider><PwaUpdatePrompt /></I18nProvider>)
}

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('オンライン中は手動更新UIを表示しない', () => {
    renderPrompt('ja')

    expect(screen.queryByText('安全に更新')).not.toBeInTheDocument()
    expect(screen.queryByText(/オフラインです/)).not.toBeInTheDocument()
  })

  it('オフライン中は日本語で従来どおり接続状態を表示する', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    renderPrompt('ja')

    expect(screen.getByText('オフラインです。入力内容を保持したまま接続をお待ちください。')).toBeInTheDocument()
  })

  it('shows the offline connection status in English', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    renderPrompt('en')

    expect(screen.getByText("You're offline. We'll keep your input while you wait to reconnect.")).toBeInTheDocument()
  })

  it('オンラインに戻ると接続状態を非表示にする', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    renderPrompt('ja')
    fireEvent.online(window)

    expect(screen.queryByText(/オフラインです/)).not.toBeInTheDocument()
  })

  it('既存Service Workerの更新時だけ一度リロードする', () => {
    const events = new EventTarget()
    const serviceWorker = {
      addEventListener: events.addEventListener.bind(events),
      controller: {} as ServiceWorker,
      removeEventListener: events.removeEventListener.bind(events),
    }
    const reload = vi.fn()

    reloadOnServiceWorkerChange(serviceWorker, reload)
    events.dispatchEvent(new Event('controllerchange'))
    events.dispatchEvent(new Event('controllerchange'))

    expect(reload).toHaveBeenCalledOnce()
  })

  it('Service Workerの初回導入ではリロードしない', () => {
    const events = new EventTarget()
    const serviceWorker = {
      addEventListener: events.addEventListener.bind(events),
      controller: null,
      removeEventListener: events.removeEventListener.bind(events),
    }
    const reload = vi.fn()

    reloadOnServiceWorkerChange(serviceWorker, reload)
    events.dispatchEvent(new Event('controllerchange'))

    expect(reload).not.toHaveBeenCalled()
  })

  it('初回導入を無視した後も次の更新を監視してリロードする', () => {
    const events = new EventTarget()
    const serviceWorker = {
      addEventListener: events.addEventListener.bind(events),
      controller: null,
      removeEventListener: events.removeEventListener.bind(events),
    }
    const reload = vi.fn()

    reloadOnServiceWorkerChange(serviceWorker, reload)
    events.dispatchEvent(new Event('controllerchange'))
    events.dispatchEvent(new Event('controllerchange'))

    expect(reload).toHaveBeenCalledOnce()
  })
})
