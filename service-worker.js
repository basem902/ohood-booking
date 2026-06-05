/* =====================================================
   service-worker.js — تخزين الملفات للعمل بدون إنترنت
   ===================================================== */
const CACHE = 'ohood-booking-v7';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// التثبيت: تخزين ملفات التطبيق
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// التفعيل: حذف الإصدارات القديمة من الكاش
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// الجلب: من الكاش أولاً، ثم الشبكة
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // طلبات التنقّل: جرّب الشبكة ثم ارجع للصفحة المخزّنة
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // stale-while-revalidate: اعرض من الكاش فوراً وحدّثه من الشبكة بالخلفية
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || fetch(req);
    })
  );
});
