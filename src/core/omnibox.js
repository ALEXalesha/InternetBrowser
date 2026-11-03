// Адресная строка: что открыть по набранному тексту - адрес или поиск, и подсказки из своей
// истории и закладок (на сервер поисковика ничего не уходит, пока не нажат Enter).
'use strict';

const { isKnownTld } = require('./tlds');
const { searchUrl } = require('./search');
const pages = require('./pages');

// Схемы, которые из строки не открываются никогда: набранный текст с ними - просто поиск.
const BLOCKED = new Set(['javascript', 'vbscript', 'data', 'blob', 'filesystem', 'chrome', 'devtools', 'view-source',
  'chrome-extension', 'ws', 'wss', 'ftp', 'mailto', 'tel', 'sms', 'intent', 'jar', 'ms-settings']);
// Окончания домашней сети: там почти всегда простой http.
const PLAIN_HTTP = new Set(['local', 'localhost', 'test', 'lan', 'home', 'internal', 'onion', 'example', 'invalid']);

const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

function isIPv4(host) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return host.split('.').every((p) => Number(p) <= 255);
}

/**
 * Разбор «хост[:порт][/путь]» без схемы. Возвращает { host, port, scheme } или null.
 * Логин в адресе (user@host) не принимается: так маскируют поддельные сайты.
 */
function hostOf(s) {
  const end = s.search(/[/?#]/);
  const auth = end < 0 ? s : s.slice(0, end);
  if (!auth || auth.includes('@') || auth.includes('\\')) return null;
  let host;
  let port = '';
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(auth);
  if (v6) {
    host = `[${v6[1]}]`;
    port = v6[2] || '';
  } else {
    const m = /^([^:]+)(?::(\d+))?$/.exec(auth);
    if (!m) return null;
    host = m[1];
    port = m[2] || '';
  }
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  if (v6) return { host, port, scheme: 'http' };
  const bare = host.endsWith('.') ? host.slice(0, -1) : host;
  if (isIPv4(bare)) return { host: bare, port, scheme: 'http' };
  const labels = bare.split('.');
  if (!labels.every((l) => LABEL.test(l))) return null;
  const tld = labels[labels.length - 1].toLowerCase();
  if (labels.length === 1) return tld === 'localhost' ? { host: bare, port, scheme: 'http' } : null;
  if (!isKnownTld(tld) || /^\d+$/.test(tld)) return null;
  return { host: bare, port, scheme: PLAIN_HTTP.has(tld) ? 'http' : 'https' };
}

function tryUrl(s) {
  try { return new URL(s); } catch { return null; }
}

function search(text, engine) {
  return { kind: 'search', query: text, url: searchUrl(engine, text) };
}

/**
 * Что открыть по тексту из адресной строки.
 *   { kind: 'empty' }                     - пустой ввод, ничего не делать
 *   { kind: 'url', url }                  - перейти по адресу
 *   { kind: 'search', query, url }        - поиск выбранным поисковиком
 * Текст, начатый с «?», - всегда поиск.
 */
function parseInput(raw, engine) {
  // Половинка эмодзи (одиночный суррогат) ломала бы кодирование запроса - заменяется на «�».
  const text = String(raw == null ? '' : raw).toWellFormed().trim();
  if (!text) return { kind: 'empty' };
  if (text.startsWith('?')) {
    const q = text.slice(1).trim();
    return q ? search(q, engine) : { kind: 'empty' };
  }
  const drive = /^([a-z]):[\\/]/i.exec(text);
  if (drive && !/\s/.test(text)) {
    const u = tryUrl('file:///' + text.replace(/\\/g, '/'));
    if (u) return { kind: 'url', url: u.href };
  }
  const sm = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  const scheme = sm ? sm[1].toLowerCase() : null;
  if (scheme === 'http' || scheme === 'https') {
    const u = tryUrl(text);
    if (u && u.hostname && /^https?:\/\//i.test(text)) return { kind: 'url', url: u.href };
    return search(text, engine);
  }
  if (scheme === 'file') {
    const u = tryUrl(text);
    return u && /^file:\/\//i.test(text) && !/\s/.test(text) ? { kind: 'url', url: u.href } : search(text, engine);
  }
  if (scheme === pages.SCHEME) {
    const c = pages.canonical(text);
    return c ? { kind: 'url', url: c } : search(text, engine);
  }
  if (scheme === 'about') {
    return text.toLowerCase() === 'about:blank' ? { kind: 'url', url: 'about:blank' } : search(text, engine);
  }
  if (scheme && BLOCKED.has(scheme)) return search(text, engine);
  if (/\s/.test(text)) return search(text, engine);
  const h = hostOf(text);
  if (!h) return search(text, engine);
  const u = tryUrl(`${h.scheme}://${text}`);
  if (!u || u.username || u.password) return search(text, engine);
  return { kind: 'url', url: u.href };
}

/** Текст для строки, когда она не в фокусе: у новой вкладки строка пустая. */
function forDisplay(url) {
  if (!url || pages.pageName(url) === 'newtab' || url === 'about:blank') return '';
  try { return decodeURI(url); } catch { return url; }
}

const DAY = 86400000;

/** Очки подсказки: закладка, частота, свежесть и совпадение с началом адреса. */
function score(e, words, now) {
  const visits = Math.max(0, e.visits || 0);
  const age = Math.max(0, (now - (e.lastVisit || 0)) / DAY);
  let s = (e.bookmarked ? 100 : 0) + 10 * Math.log2(1 + visits) + 50 * Math.pow(0.5, age / 14);
  let host = '';
  try { host = new URL(e.url).hostname.replace(/^www\./, ''); } catch { /* адрес без хоста */ }
  if (words.length && host.startsWith(words[0])) s += 30;
  return s;
}

/**
 * Подсказки адресной строки из записей { url, title, visits, lastVisit, bookmarked }:
 * в каждой есть все слова ввода (в адресе или заголовке), без повторов адреса, лучшие сверху.
 */
function suggest(input, entries, now = Date.now(), limit = 8) {
  const words = String(input || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const best = new Map();
  for (const e of entries || []) {
    if (!e || !e.url) continue;
    const hay = `${e.url} ${e.title || ''}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const s = score(e, words, now);
    const prev = best.get(e.url);
    if (!prev || s > prev.score) best.set(e.url, { url: e.url, title: e.title || '', bookmarked: !!e.bookmarked, score: s });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .slice(0, limit);
}

module.exports = { parseInput, forDisplay, suggest, hostOf, isIPv4, BLOCKED };
