export function publicAiProviderLabel(provider: string | null | undefined): string {
  if (!provider) return '—'
  return provider
}
