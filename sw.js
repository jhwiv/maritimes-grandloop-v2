// Maritimes Grand Loop — Service Worker
// Network-first for HTML so users always see the latest itinerary.
// Cache-first for static assets (icons, images) for offline + performance.

const VERSION = 'mgl-2026-06-24-01-concierge';
const HTML_CACHE = `${VERSION}-html`;
const ASSET_CACHE = `${VERSION}-assets`;

// Take over immediately on new SW activation.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clear any caches from older SW versions.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n !== HTML_CACHE && n !== ASSET_CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// Helper: is this a navigation / HTML request?
function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  const url = new URL(request.url);
  if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests; let the network handle everything else.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isHtmlRequest(req)) {
    // NETWORK-FIRST for HTML — always try the network so the itinerary is fresh.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(HTML_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        // Offline — serve the last cached HTML if we have it.
        const cached = await caches.match(req);
        if (cached) return cached;
        // Last-resort fallback: cached root.
        const root = await caches.match('/');
        if (root) return root;
        throw err;
      }
    })());
    return;
  }

  // CACHE-FIRST for static assets (icons, images, manifest, etc.)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      // No cache, no network — fail.
      throw err;
    }
  })());
});

// Allow the page to ask us to skip waiting on a new deploy.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
