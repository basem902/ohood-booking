/* =====================================================
   server.js — خادم محلي بسيط لتشغيل التطبيق (PWA)
   لا يحتاج أي مكتبات خارجية. شغّله عبر: node server.js
   ===================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath));
  // منع الخروج خارج مجلد المشروع
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('غير موجود');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log('==============================================');
  console.log('  حجوزات عهود يعمل الآن على:');
  console.log('  ' + url);
  console.log('  (اترك هذه النافذة مفتوحة أثناء الاستخدام)');
  console.log('==============================================');
  // فتح المتصفح تلقائياً على ويندوز
  exec(`start "" "${url}"`);
});
