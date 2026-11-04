// «Сайт» для выключателя блокировки и счётчика: имя хоста без «www.», только для http(s).
'use strict';

function siteOf(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/** Адрес, который стоит записать в историю: только обычные страницы, не внутренние и не data:. */
function isHistoryUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:';
}

// Electron даёт страницам file:// больше, чем Chrome: fetch и XHR читают любой файл на диске.
// Как в Chrome: страница с диска грузит картинки, стили, скрипты и рамки, но не читает файлы.
const FILE_OK = new Set(['mainFrame', 'subFrame', 'image', 'stylesheet', 'script', 'font', 'media']);

function blocksFileRead(url, type) {
  return /^file:/i.test(String(url)) && !FILE_OK.has(type);
}

module.exports = { siteOf, isHistoryUrl, blocksFileRead };
