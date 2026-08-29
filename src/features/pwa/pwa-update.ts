type ServiceWorkerEvents = Pick<
  ServiceWorkerContainer,
  'addEventListener' | 'controller' | 'removeEventListener'
>

export function reloadOnServiceWorkerChange(
  serviceWorker: ServiceWorkerEvents | undefined,
  reload: () => void,
) {
  if (!serviceWorker) return () => undefined

  let reloading = false
  let ignoreInitialClaim = !serviceWorker.controller
  const controllerChange = () => {
    if (ignoreInitialClaim) {
      ignoreInitialClaim = false
      return
    }
    if (reloading) return
    reloading = true
    reload()
  }

  serviceWorker.addEventListener('controllerchange', controllerChange)
  return () => serviceWorker.removeEventListener('controllerchange', controllerChange)
}
