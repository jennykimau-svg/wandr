// Wandr Service Worker
// Handles: share target interception, offline caching, background sync

const CACHE_NAME = 'wandr-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app.js',
  '/app.css',
];

// ─── Install: cache static shell ───────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: serve from cache, fall back to network ─────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Share target POST — intercept and redirect to app with data
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Standard cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ─── Share target handler ───────────────────────────────────────────────────
async function handleShareTarget(request) {
  const formData = await request.formData();
  const sharedUrl   = formData.get('url')   || '';
  const sharedText  = formData.get('text')  || '';
  const sharedTitle = formData.get('title') || '';

  // Extract the actual URL — it may be in the text field on some platforms
  // Instagram and TikTok both put the link in `text` when sharing via share sheet
  const urlMatch = (sharedUrl || sharedText).match(/https?:\/\/[^\s]+/);
  const extractedUrl = urlMatch ? urlMatch[0] : '';

  // Store in IndexedDB so the app can pick it up on next render
  await storeIncomingShare({
    url: extractedUrl,
    text: sharedText,
    title: sharedTitle,
    receivedAt: Date.now(),
  });

  // Redirect to app — the app checks for pending shares on load
  return Response.redirect('/?incoming=1', 303);
}

// ─── IndexedDB helpers ──────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wandr', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('places')) {
        db.createObjectStore('places', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeIncomingShare(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shares', 'readwrite');
    tx.objectStore('shares').add(data);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Background sync (future: retry failed extractions) ────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'retry-extraction') {
    event.waitUntil(retryFailedExtractions());
  }
});

async function retryFailedExtractions() {
  // Placeholder — in production this retries any extractions that
  // failed due to network issues while the user was offline
  console.log('[Wandr SW] Retrying failed extractions…');
}
