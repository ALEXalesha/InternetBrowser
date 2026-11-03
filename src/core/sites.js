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

module.exports = { siteOf, isHistoryUrl };
