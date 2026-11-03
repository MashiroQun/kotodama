import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      // Rin Player-style update UI: stage a new worker until the user accepts.
      // On a fresh app launch, the app may apply a waiting update automatically.
      registerType: 'prompt',
      injectRegister: 'script',
      workbox: {
        skipWaiting: false,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:tone|three\.js)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kotodama-audio-visual-libs',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'kotodama-fonts',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      
      manifest: {
        id: 'com.mashiro.kotodama-tuner',
        name: '言霊チューナー',
        short_name: '言霊Tuner',
        description: 'チャクラ調整用サウンド＆ビジュアルアイザー',
        start_url: './',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        lang: 'ja',
        icons: [
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        screenshots: [
          {
            src: 'screenshot-mobile.png',
            sizes: '750x1334',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'モバイル画面'
          },
          {
            src: 'screenshot-desktop.png',
            sizes: '1920x1080',
            type: 'image/png',
            form_factor: 'wide',
            label: 'デスクトップ画面'
          }
        ]
      }
    })
  ]
})
