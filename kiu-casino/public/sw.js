// ═══════════════════════════════════════════════════════
//  PIXEL PLAYZONE — Service Worker (PWA Offline + Cache)
// ═══════════════════════════════════════════════════════
const CACHE_NAME = 'playzone-v2';
const STATIC_ASSETS = [
    '/',
    '/css/fonts.css',
    '/fonts/dearpix-1-94.ttf',
    '/images/icons/icon-192.svg',
    '/images/icons/icon-512.svg',
    '/sounds/click.mp3',
    '/sounds/win.mp3',
    '/sounds/lose.mp3',
    '/sounds/bet.mp3'
];

// Install: cache essential assets
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('[SW] Some assets failed to cache:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Network-first for API, Cache-first for static
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Skip non-GET, socket.io, auth routes
    if (e.request.method !== 'GET') return;
    if (url.pathname.startsWith('/socket.io')) return;
    if (url.pathname.startsWith('/auth')) return;
    if (url.pathname.startsWith('/api')) return;

    // Skip cross-origin requests (Google Fonts, CDNs, etc.) — let browser handle them directly
    if (url.origin !== self.location.origin) return;

    // Cache-first for static assets (fonts, images, sounds, css)
    if (/\.(ttf|woff2?|png|jpg|webp|svg|mp3|ogg|wav|css|js)$/i.test(url.pathname)) {
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                return fetch(e.request).then(resp => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                    }
                    return resp;
                }).catch(() => cached || new Response('Offline', { status: 503 }));
            })
        );
        return;
    }

    // Network-first for HTML pages
    e.respondWith(
        fetch(e.request).then(resp => {
            if (resp.ok && url.origin === self.location.origin) {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            }
            return resp;
        }).catch(() => caches.match(e.request).then(r => r || new Response('Offline', { status: 503 })))
    );
});

// Push notification handler
self.addEventListener('push', e => {
    const data = e.data ? e.data.json() : {};
    const title = data.title || 'Pixel PlayZone';
    const options = {
        body: data.body || 'Bạn có thông báo mới!',
        icon: '/images/icons/icon-192.svg',
        badge: '/images/icons/icon-72.svg',
        vibrate: [100, 50, 100],
        data: { url: data.url || '/' },
        actions: data.actions || []
    };
    e.waitUntil(self.registration.showNotification(title, options));
});

// Notification click handler
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const url = e.notification.data?.url || '/';
    e.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes(url) && 'focus' in client) return client.focus();
            }
            return clients.openWindow(url);
        })
    );
});
