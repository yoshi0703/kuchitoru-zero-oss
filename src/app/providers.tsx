import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { AuthProvider } from '../features/auth/auth-context'
import { PwaUpdatePrompt } from '../features/pwa/PwaUpdatePrompt'
import { ThemeProvider } from '../shared/theme/ThemeProvider'
import { I18nProvider } from '../shared/i18n'

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  )

  return (
    <MotionConfig reducedMotion="user">
      <I18nProvider><ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
          <PwaUpdatePrompt />
        </QueryClientProvider>
      </ThemeProvider></I18nProvider>
    </MotionConfig>
  )
}
