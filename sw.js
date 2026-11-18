/* SaySave service worker: offline app shell + receives files from the Android share sheet. */
const CACHE = 'saysave-v4';
const SHELL = ['./', './index.html', './styles.css', './logic.js', './drive.js', './scan.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function putInbox(records) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('saysave', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('inbox', { autoIncrement: true });
    rq.onsuccess = () => {
      const tx = rq.result.transaction('inbox', 'readwrite');
      const os = tx.objectStore('inbox');
      records.forEach(r => os.add(r));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    };
    rq.onerror = () => reject(rq.error);
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Share target: Android sends the shared file(s) here as a POST
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('file').filter(f => f && typeof f === 'object');
        await putInbox(files.map(f => ({ file: f, name: f.name, type: f.type })));
      } catch (err) { /* fall through to app */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // App shell: network first (so updates arrive), cache as fallback when offline
  // always ask the server for the newest version (skip the browser's 10-minute cache)
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
