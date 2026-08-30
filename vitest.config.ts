import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    coverage: {
      exclude: [
        'e2e/**',
        'scripts/test/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
    environment: 'jsdom',
    exclude: ['e2e/**', 'dist/**', 'node_modules/**', 'supabase/**'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{js,mjs,ts}',
    ],
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    setupFiles: ['./scripts/test/setup.ts'],
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
