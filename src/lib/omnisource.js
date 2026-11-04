// Подсказки адресной строки из хранилища: первая строка - что будет по Enter (открыть адрес
// или искать), дальше - история и закладки. Всё берётся только из своего профиля.
'use strict';

const { parseInput, suggest } = require('../core/omnibox');

function suggestions(store, text, engine, now = Date.now(), limit = 7) {
  const parsed = parseInput(text, engine);
  if (parsed.kind === 'empty') return [];
  const first = parsed.kind === 'url'
    ? { type: 'open', url: parsed.url, title: '' }
    : { type: 'search', url: parsed.url, title: parsed.query };
  const byUrl = new Map();
  for (const h of store.searchHistory(text, 300)) byUrl.set(h.url, { ...h });
  for (const b of store.searchBookmarks(text, 100)) {
    const e = byUrl.get(b.url);
    if (e) { e.bookmarked = true; if (!e.title) e.title = b.title; } else byUrl.set(b.url, { url: b.url, title: b.title, visits: 0, lastVisit: b.added, bookmarked: true });
  }
  const rest = suggest(text, [...byUrl.values()], now, limit + 1)
    .filter((s) => s.url !== first.url)
    .slice(0, limit)
    .map((s) => ({ type: s.bookmarked ? 'bookmark' : 'history', url: s.url, title: s.title }));
  return [first, ...rest];
}

module.exports = { suggestions };
