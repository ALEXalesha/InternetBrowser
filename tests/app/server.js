// Сервер-прокси законов окна. Браузер идёт через него ко всем сайтам (--proxy-server):
// сайты *.test отдаются отсюда, всё остальное записывается в leaks и не пускается.
'use strict';
const http = require('http');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const FILE = Buffer.from('InternetBrowser test file\n'.repeat(400));

const LIST = `[Adblock Plus 2.0]
! Title: test list
||ads.test^
||tracker.test^$third-party
##.ad-banner
site.test##.promo
`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Test site</title>
<link rel="icon" href="/favicon.png"></head><body>
<h1 id="h">Hello from site.test</h1>
<p id="text">Обычный текст страницы.</p>
<div class="ad-banner" id="banner">AD</div>
<div class="promo" id="promo">PROMO</div>
<div class="content" id="content">Content</div>
<script>window.adsLoaded = false;</script>
<script src="http://ads.test/ads.js"></script>
<img id="px" src="http://tracker.test/pixel.gif" width="1" height="1">
<img id="ok" src="/ok.png" width="1" height="1">
<iframe id="frame" src="http://ads.test/frame.html" width="10" height="10"></iframe>
<p><a id="dl" href="/file.bin">Download</a> <a id="pop" href="http://other.test/" target="_blank">Other</a>
<a id="internal" href="ib://settings/">Settings</a> <a id="next" href="/two.html">Two</a></p>
</body></html>`;

// Статья для снимков README: обычный текст, рекламные места и счётчики, как на новостном сайте.
const ARTICLE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Как устроено жидкое стекло</title>
<link rel="icon" href="/favicon.png">
<style>body{margin:0;font:17px/1.6 Georgia,serif;color:#1d1d1f;background:#fafafa}header{background:#fff;border-bottom:1px solid #e5e5e5;padding:14px 32px;font:700 22px system-ui}
main{max-width:720px;margin:0 auto;padding:28px 32px}h1{font:700 34px/1.2 system-ui;margin:0 0 10px}.lead{color:#555;font-size:19px}.meta{color:#888;font:14px system-ui;margin-bottom:22px}
.ad-banner{height:90px;background:#ffe14d;display:grid;place-items:center;font:700 20px system-ui}figure{margin:24px 0;height:220px;border-radius:14px;background:linear-gradient(135deg,#5b8def,#9d5bef 60%,#ff7ab6)}</style></head>
<body><header>Новости техники</header><main><div class="ad-banner">РЕКЛАМА: купите сейчас!</div>
<h1>Как устроено жидкое стекло</h1><p class="lead">Полупрозрачные панели, блики по краю и мягкие тени: разбираем, из чего складывается стиль Liquid Glass и почему он хорошо смотрится на градиенте.</p>
<p class="meta">4 ноября 2026 · 6 минут чтения</p><figure></figure>
<p>Стекло в интерфейсе - это не просто прозрачность. Под панелью размывается то, что лежит сзади, сверху ложится тонкий блик, а по краю идёт светлая кромка. Вместе они дают ощущение толщины.</p>
<div class="ad-banner">Баннер партнёра</div>
<p>Цвета берутся из темы: в «Стеклянной» фон - фиолетово-синий градиент с пятнами, в «Светлой» стекло становится тёмным и почти незаметным.</p>
<script src="http://ads.test/ads.js"></script><script src="http://tracker.test/pixel.gif"></script>
<img src="http://tracker.test/pixel.gif" width="1" height="1"><iframe src="http://ads.test/frame.html" width="1" height="1" style="border:0"></iframe>
<img src="http://ads.test/banner.png" width="1" height="1"><img src="http://tracker.test/collect?id=1" width="1" height="1">
<p>Главное правило - текст должен читаться в любой теме. Поэтому у каждой темы проверяется контраст: не меньше 4,5 к 1 для обычного текста.</p></main></body></html>`;

const TWO = '<!doctype html><title>Second page</title><h1>Two</h1><a id="back" href="/page.html">back</a>';
const OTHER = '<!doctype html><title>Other site</title><link rel="icon" href="http://tracker.test/icon.png?uid=42"><h1 id="h">Other</h1><img src="http://tracker.test/pixel.gif">';

function start() {
  const hits = [];
  const leaks = [];
  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(/^https?:/.test(req.url) ? req.url : `http://${req.headers.host}${req.url}`); } catch { res.writeHead(400); res.end(); return; }
    const host = u.hostname;
    if (!host.endsWith('.test')) { leaks.push(u.href); res.writeHead(502); res.end(); return; }
    hits.push(u.href);
    const send = (type, body, extra) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
    if (host === 'lists.test') return send('text/plain', LIST);
    if (host === 'ads.test') return u.pathname.endsWith('.js') ? send('text/javascript', 'window.adsLoaded = true;') : send('text/html', '<p>ad frame</p>');
    if (host === 'tracker.test') return send('image/gif', GIF);
    if (host === 'other.test') return send('text/html; charset=utf-8', OTHER);
    if (host === 'news.test') return u.pathname === '/favicon.png' ? send('image/png', PNG) : send('text/html; charset=utf-8', ARTICLE);
    if (host === 'site.test') {
      if (u.pathname === '/' || u.pathname === '/page.html') return send('text/html; charset=utf-8', PAGE);
      if (u.pathname === '/two.html') return send('text/html; charset=utf-8', TWO);
      if (u.pathname === '/redir') { res.writeHead(302, { location: u.searchParams.get('to') || 'ib://settings/' }); res.end(); return undefined; }
      if (u.pathname === '/favicon.png' || u.pathname === '/ok.png') return send('image/png', PNG);
      if (u.pathname === '/file.bin') return send('application/octet-stream', FILE, { 'content-disposition': 'attachment; filename="report.bin"', 'content-length': FILE.length });
      if (u.pathname === '/slow.bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="slow.bin"', 'content-length': 1000000 });
        res.write(Buffer.alloc(1000));
        return undefined;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return undefined;
  });
  server.on('connect', (req, socket) => {
    leaks.push(`CONNECT ${req.url}`);
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        hits,
        leaks,
        FILE,
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
      });
    });
  });
}

module.exports = { start, LIST };
