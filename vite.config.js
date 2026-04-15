import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      manifest: {
        name: '言霊チューナー',
        short_name: '言霊Tuner',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any' // ← anyのみに変更
          },
          {
            src: 'icon-512.png', // 本来は専用の「icon-maskable-512.png」を用意するのがベスト
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable' // ← 分けて記述
          }
        ],
        screenshots: [
          {
            src: 'screenshot-mobile.png',
            sizes: '750x1334', // 実際のサイズに合わせて変更してください
            type: 'image/png',
            form_factor: 'narrow'
          },
          {
            src: 'screenshot-desktop.png',
            sizes: '1920x1080', // 実際のサイズに合わせて変更してください
            type: 'image/png',
            form_factor: 'wide'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'external-libs',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ]
});
