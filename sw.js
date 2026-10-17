var CACHE = 'alel-pulse-v2-1';
var URLS = ['/ALEL_Pulse_Web/', '/ALEL_Pulse_Web/index.html', '/ALEL_Pulse_Web/shim.js', '/ALEL_Pulse_Web/admin-tab.js', '/ALEL_Pulse_Web/manifest.json', '/ALEL_Pulse_Web/pulse.png', '/ALEL_Pulse_Web/alel.png', '/ALEL_Pulse_Web/enovar.png', '/ALEL_Pulse_Web/res.png', '/ALEL_Pulse_Web/prev.png'];
self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return Promise.all(URLS.map(function(u) { return c.add(u).catch(function() { return null; }); })); }).then(function() { return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) { return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })); }).then(function() { return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(function(resp) {
    if (resp && resp.status === 200) { var cl = resp.clone(); caches.open(CACHE).then(function(c) { c.put(e.request, cl); }); }
    return resp;
  }).catch(function() { return caches.match(e.request); }));
});
