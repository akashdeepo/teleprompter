// Keeps the prompter working with no internet once it has been opened. Files come from the
// cache straight away and are refreshed in the background, so an update shows on the next open.
// Bump VERSION when the list of files changes.
var VERSION = 'rsp-2';
var FILES = ['./', 'index.html', 'prompter.css', 'parse.js', 'app.js', 'awake.js', 'manifest.webmanifest',
  'fonts/Mukta-Medium.ttf', 'fonts/Cinzel-Regular.ttf', 'brand/emblem.png', 'fonts/Mukta-SemiBold.ttf', 'fonts/Mukta-ExtraBold.ttf',
  'icons/app-192.png', 'icons/app-512.png',
  'icons/add-24-regular.svg', 'icons/subtract-24-regular.svg', 'icons/arrow-left-24-regular.svg',
  'icons/edit-24-regular.svg', 'icons/delete-24-regular.svg', 'icons/play-24-filled.svg',
  'icons/pause-24-filled.svg', 'icons/previous-24-filled.svg', 'icons/arrow-undo-24-regular.svg',
  'icons/text-t-24-regular.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var fresh = fetch(e.request).then(function (r) { if (r.ok) c.put(e.request, r.clone()); return r; });
      if (hit) { fresh.catch(function () {}); return hit; }
      return fresh;
    });
  }));
});
