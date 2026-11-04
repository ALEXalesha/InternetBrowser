// Протокол ib:// - свои страницы браузера и его интерфейс, из файлов приложения.
//   ib://ui/<файл>       полоса вкладок и всплывающие окна (src/ui)
//   ib://<страница>/     newtab, history, bookmarks, downloads, settings (src/pages/<имя>.html)
//   ib://<страница>/<файл> общие файлы страниц (src/pages)
//   ib://core/i18n.js    строки RU/EN (src/core/i18n.js) - единственный файл ядра, нужный страницам
// У всех ответов строгий CSP: в сеть эти страницы не ходят и в рамки чужих сайтов не встают.
'use strict';

const fs = require('fs');
const path = require('path');
const { PAGES } = require('../core/pages');

const SRC = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const CSP = "default-src 'none'; script-src ib:; style-src ib: 'unsafe-inline'; img-src ib: data:; font-src ib:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Файл на диске для адреса ib:// или null. Выйти за свою папку (../) нельзя. */
function fileFor(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'ib:') return null;
  const host = u.hostname.toLowerCase();
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch { return null; }
  rel = rel.replace(/^\/+/, '');
  let root;
  if (host === 'ui') {
    root = path.join(SRC, 'ui');
    if (!rel) rel = 'index.html';
  } else if (host === 'core') {
    return rel === 'i18n.js' ? path.join(SRC, 'core', 'i18n.js') : null;
  } else if (PAGES.includes(host)) {
    root = path.join(SRC, 'pages');
    if (!rel) rel = `${host}.html`;
  } else {
    return null;
  }
  const file = path.resolve(root, rel);
  if (path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) return null;
  return file;
}

function respond(raw) {
  const file = fileFor(raw);
  let body = null;
  if (file) {
    try { body = fs.readFileSync(file); } catch { body = null; }
  }
  if (!body) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'content-security-policy': CSP } });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' },
  });
}

function install(ses) {
  ses.protocol.handle('ib', (req) => respond(req.url));
}

module.exports = { fileFor, respond, install, CSP };
