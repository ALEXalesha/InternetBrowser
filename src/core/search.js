// Поисковики адресной строки. Запрос уходит только туда, куда пользователь сам его набрал:
// подсказок с сервера поисковика нет (они отправляли бы каждую набранную букву).
'use strict';

const ENGINES = [
  { id: 'duckduckgo', name: 'DuckDuckGo', base: 'https://duckduckgo.com/', param: 'q' },
  { id: 'google', name: 'Google', base: 'https://www.google.com/search', param: 'q' },
  { id: 'bing', name: 'Bing', base: 'https://www.bing.com/search', param: 'q' },
  { id: 'yandex', name: 'Яндекс', nameEn: 'Yandex', base: 'https://yandex.ru/search/', param: 'text' },
  { id: 'startpage', name: 'Startpage', base: 'https://www.startpage.com/do/search', param: 'query' },
  { id: 'ecosia', name: 'Ecosia', base: 'https://www.ecosia.org/search', param: 'q' },
];
const DEFAULT_ENGINE = 'duckduckgo';

function engine(id) {
  return ENGINES.find((e) => e.id === id) || ENGINES.find((e) => e.id === DEFAULT_ENGINE);
}

function searchUrl(id, query) {
  const e = engine(id);
  return `${e.base}?${e.param}=${encodeURIComponent(query)}`;
}

/** Запрос из адреса страницы результатов (или null): чтобы в строке стоял запрос, а не длинный адрес. */
function queryFromUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  for (const e of ENGINES) {
    const b = new URL(e.base);
    if (u.origin === b.origin && u.pathname === b.pathname && u.searchParams.has(e.param)) return u.searchParams.get(e.param);
  }
  return null;
}

module.exports = { ENGINES, DEFAULT_ENGINE, engine, searchUrl, queryFromUrl };
