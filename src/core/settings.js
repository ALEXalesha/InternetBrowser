// Настройки браузера: значения по умолчанию и приведение к допустимым. Файл настроек мог
// испортиться или прийти из другой версии - из него берётся только то, что понятно.
'use strict';

const { normalizeTheme, DEFAULT_THEME } = require('./themes');
const { ENGINES, DEFAULT_ENGINE } = require('./search');

const LANGS = ['auto', 'ru', 'en'];

const DEFAULT_LINKS = [
  { title: 'Хаб', url: 'https://alexalesha.github.io/' },
  { title: 'GitHub', url: 'https://github.com/ALEXalesha' },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
];

const DEFAULTS = Object.freeze({
  lang: 'auto',
  theme: DEFAULT_THEME,
  engine: DEFAULT_ENGINE,
  blocking: true,
  cosmetic: true,
  listsAutoUpdate: true,
  bookmarksBar: true,
  restoreTabs: false,
  links: DEFAULT_LINKS,
});

const MAX_LINKS = 12;

function bool(v, d) {
  return typeof v === 'boolean' ? v : d;
}

function links(v) {
  if (!Array.isArray(v)) return DEFAULT_LINKS.map((l) => ({ ...l }));
  const out = [];
  for (const l of v) {
    if (!l || typeof l.url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(l.url)) continue;
    let u;
    try { u = new URL(l.url); } catch { continue; }
    const title = typeof l.title === 'string' && l.title.trim() ? l.title.trim().slice(0, 40) : u.hostname;
    out.push({ title, url: u.href });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    lang: LANGS.includes(s.lang) ? s.lang : DEFAULTS.lang,
    theme: normalizeTheme(s.theme),
    engine: ENGINES.some((e) => e.id === s.engine) ? s.engine : DEFAULTS.engine,
    blocking: bool(s.blocking, DEFAULTS.blocking),
    cosmetic: bool(s.cosmetic, DEFAULTS.cosmetic),
    listsAutoUpdate: bool(s.listsAutoUpdate, DEFAULTS.listsAutoUpdate),
    bookmarksBar: bool(s.bookmarksBar, DEFAULTS.bookmarksBar),
    restoreTabs: bool(s.restoreTabs, DEFAULTS.restoreTabs),
    links: links(s.links),
  };
}

/** Язык интерфейса: выбранный или по языку системы (русский - для ru, uk, be, kk). */
function resolveLang(setting, systemLocale) {
  if (setting === 'ru' || setting === 'en') return setting;
  return /^(ru|uk|be|kk)\b/i.test(String(systemLocale || '')) ? 'ru' : 'en';
}

module.exports = { DEFAULTS, LANGS, MAX_LINKS, normalizeSettings, resolveLang };
