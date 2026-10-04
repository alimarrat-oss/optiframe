// Service worker : l'app fonctionne hors ligne après le premier chargement (contexte humanitaire).
// Stratégie « réseau d'abord, cache en secours » : toujours la dernière version quand on est en ligne.
const CACHE = 'optiframe-v2';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/i18n.js', 'js/exif.js', 'js/camera.js', 'js/viewer.js', 'js/worker.js',
  'js/vision/image.js', 'js/vision/homography.js', 'js/vision/markers.js', 'js/vision/rectify.js',
  'js/vision/segment.js', 'js/vision/geom.js', 'js/vision/measure.js', 'js/vision/pipeline.js',
  'js/vision/refine.js', 'js/vision/gridrefine.js',
  'js/nn/unet.js', 'js/frame/frame.js', 'js/frame/svg.js',
  'lib/three/three.module.js', 'lib/three/three.core.js', 'lib/three/addons/controls/OrbitControls.js',
  'lib/manifold/manifold.js', 'lib/manifold/manifold.wasm', 'lib/qrcode/qrcode.mjs',
  'models/lensunet.json', 'models/lensunet.bin',
  'assets/icon.svg', 'assets/setup.svg', 'assets/feuille-capture-optiframe.pdf', 'assets/feuille-capture-optiframe-A4.pdf',
  'assets/demo/verre_clair_OD.jpg', 'assets/demo/verre_teinte_OG.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
