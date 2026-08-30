import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function resolveBuildSha(): string {
  const environmentSha = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA
  const sha = environmentSha ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Build SHA must be a full 40-character Git SHA')
  return sha.toLowerCase()
}

export default defineConfig({
  base: '/',
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(resolveBuildSha()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Vite 8/Rolldown can stall while copying public assets on this macOS runtime.
  // The production script copies the same files after the bundle has completed.
  publicDir: false,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'apple-touch-icon.png',
        'icons/kuchitoru-zero-logo-192.png',
        'icons/kuchitoru-zero-logo-512.png',
        'icons/kuchitoru-zero-logo-1024.png',
      ],
      manifest: {
        name: 'クチトルZero Community',
        short_name: 'クチトルZero',
        description: 'クチトルZero Community — QRアンケートとMEO運用のセルフホスト版',
        theme_color: '#115e59',
        background_color: '#f3f5f7',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        lang: 'ja',
        icons: [
          {
            src: '/icons/kuchitoru-zero-logo-192.png?v=20260805-transparent',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/kuchitoru-zero-logo-512.png?v=20260805-transparent',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/kuchitoru-zero-logo-1024.png?v=20260805-transparent',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/functions\/v1\//,
          /^\/rest\/v1\//,
          /^\/auth\/v1\//,
          /^\/blog(?:\/|$)/,
          /^\/sitemap(?:-|\.)/,
          /^\/robots\.txt$/,
          /^\/llms\.txt$/,
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
