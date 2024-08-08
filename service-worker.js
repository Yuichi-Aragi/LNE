const CACHE_NAME = 'light-novels-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png',
    '/favicon.ico',
    'offline.html',
    'https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css',
    'https://cdnjs.cloudflare.com/ajax/libs/lazysizes/5.3.2/lazysizes.min.js',
    'https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js'
];

self.addEventListener('install', async (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(urlsToCache);
        })()
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        (async () => {
            const response = await caches.match(event.request);
            if (response) {
                // Return cached response
                return response;
            }

            try {
                // Fetch new data
                const networkResponse = await fetch(event.request);
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }

                // Cache the new data
                const responseToCache = networkResponse.clone();
                const cache = await caches.open(CACHE_NAME);
                cache.put(event.request, responseToCache);

                return networkResponse;
            } catch (error) {
                // If fetch fails, return offline page
                return caches.match('/offline.html');
            }
        })()
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })()
    );
});