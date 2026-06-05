/* =====================================================
   db.js — غلاف بسيط لقاعدة البيانات الداخلية IndexedDB
   قاعدة بيانات حقيقية تعمل داخل المتصفح وتُخزَّن على الجهاز
   ===================================================== */
const DB = (() => {
  const NAME = 'ohood-booking-db';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // مخزن الحجوزات
        if (!db.objectStoreNames.contains('bookings')) {
          const s = db.createObjectStore('bookings', { keyPath: 'id' });
          s.createIndex('date', 'date', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
        // مخزن الباقات
        if (!db.objectStoreNames.contains('packages')) {
          db.createObjectStore('packages', { keyPath: 'id' });
        }
        // مخزن الإعدادات
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // تشغيل طلب IndexedDB وإرجاع Promise
  function run(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function store(name, mode) {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  return {
    async getAll(name) {
      return run((await store(name, 'readonly')).getAll());
    },
    async get(name, key) {
      return run((await store(name, 'readonly')).get(key));
    },
    async put(name, value) {
      return run((await store(name, 'readwrite')).put(value));
    },
    async del(name, key) {
      return run((await store(name, 'readwrite')).delete(key));
    },
    async clear(name) {
      return run((await store(name, 'readwrite')).clear());
    },
    // جلب السجلات حسب فهرس معيّن (مثل كل الحجوزات في تاريخ محدد)
    async byIndex(name, index, value) {
      const os = await store(name, 'readonly');
      return run(os.index(index).getAll(value));
    },
  };
})();
