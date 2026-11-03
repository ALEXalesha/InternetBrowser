// Внутренние страницы браузера: ib://<имя>/. Только они получают доступ к данным браузера.
'use strict';

const SCHEME = 'ib';
const PAGES = ['newtab', 'history', 'bookmarks', 'downloads', 'settings'];
const NEWTAB = 'ib://newtab/';

/** Имя внутренней страницы по адресу или null. */
function pageName(raw) {
  const m = /^ib:\/\/([a-z]+)\/?(?:[?#].*)?$/i.exec(String(raw || ''));
  if (!m) return null;
  const name = m[1].toLowerCase();
  return PAGES.includes(name) ? name : null;
}

/** Канонический вид адреса внутренней страницы (с косой чертой) или null. */
function canonical(raw) {
  const name = pageName(raw);
  if (!name) return null;
  const tail = /^ib:\/\/[a-z]+\/?(.*)$/i.exec(raw)[1];
  return `ib://${name}/${tail}`;
}

module.exports = { SCHEME, PAGES, NEWTAB, pageName, canonical };
