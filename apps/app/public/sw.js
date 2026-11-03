// Service worker: makes the app installable and loads the app shell fast.
// API calls always go to the network (levels and plans must never be stale).
const CACHE = 'veleggia-shell-v2';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // Network first, cache as fallback, so an update is picked up as soon as you are online.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});

// Push alerts from the rule checks.
self.addEventListener('push', (e) => {
  let note = { title: 'Veleggia', body: 'New alert.' };
  try { note = e.data ? e.data.json() : note; } catch { note.body = e.data ? e.data.text() : note.body; }
  e.waitUntil(self.registration.showNotification(note.title, {
    body: note.body, tag: note.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: note.url || '/?tab=alerts' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/?tab=alerts';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { if (c.navigate) c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
