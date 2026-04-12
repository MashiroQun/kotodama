const CACHE_NAME = 'kotodama-v2';

// 必要なファイルをリスト化
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://mashiroqun.github.io/kotodama/icon2.png',
  './icon2.png?v=2',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@100;400;700;900&family=Noto+Sans+JP:wght@400;700;900&family=Noto+Sans+Siddham&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ファイルを1つずつ個別にキャッシュし、外部CDNのエラー等でインストール全体が止まるのを防ぐ
      return Promise.all(
        ASSETS.map((url) => {
          return cache.add(url).catch((err) => {
            console.error('[SW] キャッシュの取得に一部スキップが発生しました:', url);
          });
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).catch(() => {
        // オフライン時のHTML要求に対しては強制的にキャッシュのindex.htmlを返す（究極の安全網）
        if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
          return caches.match('./index.html', { ignoreSearch: true }) || caches.match('./', { ignoreSearch: true });
        }
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
