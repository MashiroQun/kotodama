manifest: {
        id: '/', // ★追加：アプリの識別子を固定します
        name: '言霊チューナー',
        short_name: '言霊Tuner',
        description: 'チャクラ調整用サウンド＆ビジュアルアイザー',
        start_url: './',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
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
            form_factor: 'narrow'
          },
          {
            src: 'screenshot-desktop.png',
            sizes: '1920x1080', 
            type: 'image/png',
            form_factor: 'wide'
          }
        ]
      },
