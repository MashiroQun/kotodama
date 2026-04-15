import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      
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
