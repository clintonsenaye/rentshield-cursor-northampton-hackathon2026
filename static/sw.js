/* ==========================================================================
   RentShield - Service Worker
   Provides offline support and caching for the PWA.
   ========================================================================== */

const CACHE_NAME = 'rentshield-v6';

/** Static assets to cache on install for offline support */
const STATIC_ASSETS = [
    '/',
    '/static/styles.css',
    '/static/app.js',
    '/static/manifest.json',
    '/static/icons/icon-192.svg',
    '/static/icons/icon-512.svg'
];

/**
 * Install event: pre-cache static assets so the app shell loads offline.
 */
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    /* Activate immediately without waiting for old SW to finish */
    self.skipWaiting();
});

/**
 * Activate event: clean up old caches when a new version is deployed.
 */
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames
                    .filter(function(name) { return name !== CACHE_NAME; })
                    .map(function(name) { return caches.delete(name); })
            );
        })
    );
    /* Take control of all open tabs immediately */
    self.clients.claim();
});

/**
 * Fetch event: network-first strategy for API calls, cache-first for static assets.
 *
 * - API requests (/api/*): always go to network, never cache
 * - Static assets: try cache first, fall back to network (and update cache)
 * - Navigation: try network first, fall back to cached shell
 */
self.addEventListener('fetch', function(event) {
    var requestUrl = new URL(event.request.url);

    /* Skip non-GET requests and API calls */
    if (event.request.method !== 'GET' || requestUrl.pathname.startsWith('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(function(cachedResponse) {
            if (cachedResponse) {
                /* Return cached version, but also update cache in background */
                event.waitUntil(
                    fetch(event.request).then(function(networkResponse) {
                        if (networkResponse.ok) {
                            caches.open(CACHE_NAME).then(function(cache) {
                                cache.put(event.request, networkResponse);
                            });
                        }
                    }).catch(function() { /* Network unavailable, cached version is fine */ })
                );
                return cachedResponse;
            }

            /* Not in cache: fetch from network and cache the result */
            return fetch(event.request).then(function(networkResponse) {
                if (networkResponse.ok && requestUrl.pathname.startsWith('/static/')) {
                    var responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(function() {
                /* Offline and not cached: return the app shell for navigation requests */
                if (event.request.mode === 'navigate') {
                    return caches.match('/');
                }
            });
        })
    );
});
