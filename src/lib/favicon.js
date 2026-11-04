// Значок сайта для полосы вкладок и закладок: читается потоком не больше max байт, со сроком,
// только картинка; в кэше не больше limit значков. Сеть приходит снаружи (fetch сеанса
// вкладки, без куки), блокировку проверяет вызывающий: трекер под видом значка не пройдёт.
'use strict';

const MAX = 100000;

async function readIcon(fetch, url, { max = MAX, timeout = 5000 } = {}) {
  if (/^data:image\//i.test(url)) return url.length <= max * 1.4 ? url : null;
  if (!/^https?:/i.test(url)) return null;
  const ctrl = new AbortController();
  let timer;
  // Срок не зависит от того, оборвёт ли fetch поток по сигналу: чтение гонится с таймером.
  const late = new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve(null); }, timeout); });
  try {
    return await Promise.race([read(fetch, url, max, ctrl), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function read(fetch, url, max, ctrl) {
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
    if (!res || !res.ok || !res.body) return null;
    const type = (res.headers.get('content-type') || 'image/x-icon').split(';')[0].trim().toLowerCase();
    if (!/^image\//.test(type) || Number(res.headers.get('content-length') || 0) > max) { ctrl.abort(); return null; }
    const parts = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > max) { ctrl.abort(); return null; }
      parts.push(Buffer.from(chunk));
    }
    return `data:${type};base64,${Buffer.concat(parts).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Кэш значков: при переполнении уходит самый давний. */
function iconCache(limit = 300) {
  const map = new Map();
  return {
    get(k) {
      if (!map.has(k)) return undefined;
      const v = map.get(k);
      map.delete(k);
      map.set(k, v);
      return v;
    },
    set(k, v) {
      map.delete(k);
      map.set(k, v);
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    size: () => map.size,
  };
}

module.exports = { readIcon, iconCache, MAX };
