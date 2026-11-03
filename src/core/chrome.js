// Импорт закладок и истории из Chrome. Файлы профиля только читаются: закладки - JSON-файл
// Bookmarks, история - база SQLite History, которую Chrome держит открытой, поэтому
// читается её копия во временной папке (вместе с журналом, если он есть). Сам профиль не
// меняется никогда, Chrome может быть открыт.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { isHistoryUrl } = require('./sites');

// Время Chrome - микросекунды от 1 января 1601 года (UTC).
const EPOCH_DIFF_MS = 11644473600000;

// Настоящие значения (~1,3e16) больше Number.MAX_SAFE_INTEGER: считаются в BigInt, иначе
// node:sqlite бросает RangeError, а строка из Bookmarks теряет миллисекунды.
function webkitToMs(t) {
  let big;
  if (typeof t === 'bigint') big = t;
  else if (typeof t === 'string' && /^\d{1,30}$/.test(t)) big = BigInt(t);
  else if (typeof t === 'number' && Number.isFinite(t)) big = BigInt(Math.floor(t));
  else return 0;
  if (big <= 0n) return 0;
  return Number(big / 1000n) - EPOCH_DIFF_MS;
}

function msToWebkit(ms) {
  return (BigInt(Math.floor(ms)) + BigInt(EPOCH_DIFF_MS)) * 1000n;
}

/** Папки «User Data» Chrome и Chromium, где они бывают на этой системе. */
function chromeRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.IB_CHROME_DIR) return [env.IB_CHROME_DIR];
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return ['Google\\Chrome', 'Google\\Chrome Beta', 'Chromium'].map((p) => path.win32.join(base, p, 'User Data'));
  }
  if (platform === 'darwin') {
    const base = path.posix.join(home, 'Library', 'Application Support');
    return ['Google/Chrome', 'Google/Chrome Beta', 'Chromium'].map((p) => path.posix.join(base, p));
  }
  const base = env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
  return ['google-chrome', 'google-chrome-beta', 'chromium'].map((p) => path.posix.join(base, p));
}

function exists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

/** Профили в папке «User Data»: имя из Local State, иначе имя папки. */
function listProfiles(root) {
  let names = {};
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8'));
    names = (ls && ls.profile && ls.profile.info_cache) || {};
  } catch { /* нет файла или он испорчен - имена папок */ }
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return dirs
    .filter((d) => d === 'Default' || /^Profile \d+$/.test(d))
    .map((d) => {
      const p = path.join(root, d);
      const info = names[d];
      return {
        dir: d,
        name: info && typeof info.name === 'string' && info.name ? info.name : d,
        path: p,
        hasBookmarks: exists(path.join(p, 'Bookmarks')),
        hasHistory: exists(path.join(p, 'History')),
      };
    })
    .filter((p) => p.hasBookmarks || p.hasHistory)
    .sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : a.dir.localeCompare(b.dir, 'en', { numeric: true })));
}

/** Все профили на компьютере во всех известных местах. */
function findProfiles(opts) {
  return chromeRoots(opts).flatMap((root) => listProfiles(root).map((p) => ({ ...p, root })));
}

function convertNode(n) {
  if (!n || typeof n !== 'object') return null;
  if (n.type === 'url') return isHistoryUrl(n.url) ? { title: String(n.name || ''), url: n.url, added: webkitToMs(n.date_added) } : null;
  if (n.type === 'folder' || Array.isArray(n.children)) {
    return { title: String(n.name || ''), children: (n.children || []).map(convertNode).filter(Boolean) };
  }
  return null;
}

/**
 * Закладки профиля деревом для store.importBookmarks: панель закладок - сразу, «Другие» и
 * «Мобильные» - папками с переданными названиями. Нет файла - null.
 */
function readBookmarks(profilePath, names = { other: 'Other bookmarks', synced: 'Mobile bookmarks' }) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(profilePath, 'Bookmarks'), 'utf8')); } catch { return null; }
  const roots = (data && data.roots) || {};
  const kids = (r) => (r && Array.isArray(r.children) ? r.children.map(convertNode).filter(Boolean) : []);
  const out = kids(roots.bookmark_bar);
  const other = kids(roots.other);
  const synced = kids(roots.synced);
  if (other.length) out.push({ title: names.other, children: other });
  if (synced.length) out.push({ title: names.synced, children: synced });
  return out;
}

/**
 * История профиля: [{ url, title, visits, lastVisit }], свежие сверху. Читается копия базы
 * во временной папке; копия удаляется. Нет файла - null.
 */
function readHistory(profilePath, limit = 100000) {
  const file = path.join(profilePath, 'History');
  if (!exists(file)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-chrome-'));
  try {
    const copy = path.join(tmp, 'History');
    fs.copyFileSync(file, copy);
    for (const side of ['-journal', '-wal']) if (exists(file + side)) fs.copyFileSync(file + side, copy + side);
    const db = new DatabaseSync(copy);
    try {
      const stmt = db.prepare('SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?');
      stmt.setReadBigInts(true);
      return stmt.all(limit)
        .filter((r) => isHistoryUrl(r.url))
        .map((r) => ({ url: r.url, title: String(r.title || ''), visits: Math.max(1, Number(r.visit_count) || 1), lastVisit: webkitToMs(r.last_visit_time) }));
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Перенести профиль в хранилище: закладки - в папку folderTitle на панели закладок,
 * история - слиянием (повторный импорт ничего не удваивает).
 */
function importProfile(store, profilePath, { folderTitle = 'Chrome', names } = {}) {
  const result = { bookmarks: 0, history: 0, foundBookmarks: false, foundHistory: false };
  const marks = readBookmarks(profilePath, names);
  if (marks) {
    result.foundBookmarks = true;
    const existing = store.children(store.ROOT_BAR).find((b) => b.kind === 'folder' && b.title === folderTitle);
    const folder = existing ? existing.id : store.addFolder({ parent: store.ROOT_BAR, title: folderTitle });
    result.bookmarks = store.importBookmarks(folder, marks);
  }
  const hist = readHistory(profilePath);
  if (hist) {
    result.foundHistory = true;
    result.history = store.importHistory(hist);
  }
  return result;
}

module.exports = { EPOCH_DIFF_MS, webkitToMs, msToWebkit, chromeRoots, listProfiles, findProfiles, readBookmarks, readHistory, importProfile };
