// Хранилище браузера: один файл SQLite в папке профиля (встроенный node:sqlite, без нативных
// модулей). История, закладки, загрузки, настройки, выключатели блокировки по сайтам, значки.
// Всё только локально: этот модуль не знает про сеть.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const { normalizeSettings } = require('./settings');
const { isHistoryUrl } = require('./sites');

const SCHEMA = 1;
const ROOT_BAR = 1;
const ROOT_OTHER = 2;
const MAX_FAVICON = 200000;

function hay(url, title) {
  return `${url} ${title || ''}`.toLowerCase();
}

function words(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function openStore(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
      visits INTEGER NOT NULL DEFAULT 0, last_visit INTEGER NOT NULL, hay TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS history_last ON history(last_visit DESC);
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY, parent INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('folder', 'url')), title TEXT NOT NULL DEFAULT '',
      url TEXT, position INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS bookmarks_parent ON bookmarks(parent, position);
    CREATE INDEX IF NOT EXISTS bookmarks_url ON bookmarks(url);
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
      state TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
      started INTEGER NOT NULL, finished INTEGER, mime TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS sites (site TEXT PRIMARY KEY, blocking INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS favicons (site TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);
  const q = (sql) => db.prepare(sql);
  const getMeta = q('SELECT value FROM meta WHERE key = ?');
  const setMeta = q('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (!getMeta.get('schema')) {
    tx(() => {
      setMeta.run('schema', String(SCHEMA));
      q("INSERT OR IGNORE INTO bookmarks(id, parent, kind, title, position) VALUES (?, NULL, 'folder', 'bar', 0), (?, NULL, 'folder', 'other', 1)").run(ROOT_BAR, ROOT_OTHER);
    });
  }

  // ---------- настройки ----------
  function readJson(key) {
    const row = getMeta.get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }
  function getSettings() {
    return normalizeSettings(readJson('settings'));
  }
  function setSettings(patch) {
    const next = normalizeSettings({ ...getSettings(), ...(patch || {}) });
    setMeta.run('settings', JSON.stringify(next));
    return next;
  }
  function getSession() {
    const v = readJson('session');
    return Array.isArray(v) ? v.filter((u) => typeof u === 'string').slice(0, 50) : [];
  }
  function setSession(urls) {
    setMeta.run('session', JSON.stringify((urls || []).filter((u) => typeof u === 'string').slice(0, 50)));
  }

  // ---------- история ----------
  const upsertVisit = q(`INSERT INTO history(url, title, visits, last_visit, hay) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(url) DO UPDATE SET visits = visits + 1, last_visit = MAX(last_visit, excluded.last_visit),
      title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END,
      hay = CASE WHEN excluded.title <> '' THEN excluded.hay ELSE hay END`);
  const upsertImported = q(`INSERT INTO history(url, title, visits, last_visit, hay) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET visits = MAX(visits, excluded.visits), last_visit = MAX(last_visit, excluded.last_visit),
      title = CASE WHEN title = '' THEN excluded.title ELSE title END,
      hay = CASE WHEN title = '' THEN excluded.hay ELSE hay END`);
  const setTitleQ = q("UPDATE history SET title = ?, hay = ? WHERE url = ? AND ? <> ''");
  const historyRow = (r) => ({ url: r.url, title: r.title, visits: r.visits, lastVisit: r.last_visit });

  function addVisit(url, title = '', time = Date.now()) {
    if (!isHistoryUrl(url)) return false;
    const t = String(title || '').slice(0, 500);
    upsertVisit.run(url, t, Math.floor(time), hay(url, t));
    return true;
  }
  function setTitle(url, title) {
    const t = String(title || '').slice(0, 500);
    setTitleQ.run(t, hay(url, t), url, t);
  }
  function importHistory(entries) {
    let n = 0;
    tx(() => {
      for (const e of entries || []) {
        if (!e || !isHistoryUrl(e.url)) continue;
        const t = String(e.title || '').slice(0, 500);
        upsertImported.run(e.url, t, Math.max(1, Math.floor(e.visits) || 1), Math.floor(e.lastVisit) || 0, hay(e.url, t));
        n++;
      }
    });
    return n;
  }
  /** Все записи, где есть каждое слово запроса (в адресе или заголовке), свежие сверху. */
  function searchHistory(query = '', limit = 200, offset = 0) {
    const w = words(query);
    const where = w.map(() => 'instr(hay, ?) > 0').join(' AND ') || '1';
    return q(`SELECT * FROM history WHERE ${where} ORDER BY last_visit DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...w, limit, offset).map(historyRow);
  }
  function historyCount() {
    return q('SELECT COUNT(*) AS n FROM history').get().n;
  }
  function getVisit(url) {
    const r = q('SELECT * FROM history WHERE url = ?').get(url);
    return r ? historyRow(r) : null;
  }
  function deleteHistory(urls) {
    const del = q('DELETE FROM history WHERE url = ?');
    tx(() => { for (const u of urls || []) del.run(u); });
  }
  function deleteHistorySince(time) {
    q('DELETE FROM history WHERE last_visit >= ?').run(Math.floor(time));
  }
  function clearHistory() {
    db.exec('DELETE FROM history');
  }

  // ---------- закладки ----------
  const bmRow = (r) => ({ id: r.id, parent: r.parent, kind: r.kind, title: r.title, url: r.url, position: r.position, added: r.added });
  const getBm = q('SELECT * FROM bookmarks WHERE id = ?');
  const childrenQ = q('SELECT * FROM bookmarks WHERE parent = ? ORDER BY position, id');
  const countChildren = q('SELECT COUNT(*) AS n FROM bookmarks WHERE parent = ?');
  const shiftUp = q('UPDATE bookmarks SET position = position + 1 WHERE parent = ? AND position >= ?');
  const shiftDown = q('UPDATE bookmarks SET position = position - 1 WHERE parent = ? AND position > ?');

  function bookmark(id) {
    const r = getBm.get(id);
    return r ? bmRow(r) : null;
  }
  function children(parent) {
    return childrenQ.all(parent).map(bmRow);
  }
  function isFolder(id) {
    const b = bookmark(id);
    return !!b && b.kind === 'folder';
  }
  function slot(parent, position) {
    const n = countChildren.get(parent).n;
    return Number.isInteger(position) ? Math.max(0, Math.min(n, position)) : n;
  }
  function insert(parent, kind, title, url, position, added) {
    if (!isFolder(parent)) throw new Error('нет такой папки');
    const p = slot(parent, position);
    shiftUp.run(parent, p);
    const r = q('INSERT INTO bookmarks(parent, kind, title, url, position, added) VALUES (?, ?, ?, ?, ?, ?)')
      .run(parent, kind, String(title || '').slice(0, 500), url, p, Math.floor(added) || Date.now());
    return Number(r.lastInsertRowid);
  }
  function addBookmark({ parent = ROOT_BAR, title = '', url, position, added } = {}) {
    if (!isHistoryUrl(url)) throw new Error('закладка без адреса');
    return tx(() => insert(parent, 'url', title, url, position, added));
  }
  function addFolder({ parent = ROOT_BAR, title = '', position, added } = {}) {
    return tx(() => insert(parent, 'folder', title, null, position, added));
  }
  function updateBookmark(id, { title, url } = {}) {
    const b = bookmark(id);
    if (!b || b.parent === null) return false;
    if (url !== undefined && b.kind === 'url' && !isHistoryUrl(url)) return false;
    q('UPDATE bookmarks SET title = ?, url = ? WHERE id = ?').run(
      title === undefined ? b.title : String(title).slice(0, 500),
      b.kind === 'url' && url !== undefined ? url : b.url, id);
    return true;
  }
  function isInside(id, folder) {
    for (let cur = bookmark(folder); cur; cur = cur.parent === null ? null : bookmark(cur.parent)) {
      if (cur.id === id) return true;
    }
    return false;
  }
  /** Перенос в папку на место; в саму себя и в свою подпапку нельзя, корни не двигаются. */
  function moveBookmark(id, parent, position) {
    const b = bookmark(id);
    if (!b || b.parent === null || !isFolder(parent) || isInside(id, parent)) return false;
    tx(() => {
      shiftDown.run(b.parent, b.position);
      q('UPDATE bookmarks SET parent = NULL, position = -1 WHERE id = ?').run(id);
      const p = slot(parent, position);
      shiftUp.run(parent, p);
      q('UPDATE bookmarks SET parent = ?, position = ? WHERE id = ?').run(parent, p, id);
    });
    return true;
  }
  function removeBookmark(id) {
    const b = bookmark(id);
    if (!b || b.parent === null) return false;
    tx(() => {
      q('DELETE FROM bookmarks WHERE id = ?').run(id);
      shiftDown.run(b.parent, b.position);
    });
    return true;
  }
  function bookmarksByUrl(url) {
    return q("SELECT * FROM bookmarks WHERE kind = 'url' AND url = ? ORDER BY id").all(url).map(bmRow);
  }
  function searchBookmarks(query, limit = 200) {
    const w = words(query);
    return q("SELECT * FROM bookmarks WHERE kind = 'url' ORDER BY id").all().map(bmRow)
      .filter((b) => w.every((x) => hay(b.url, b.title).includes(x))).slice(0, limit);
  }
  function tree(id = null) {
    if (id === null) return [ROOT_BAR, ROOT_OTHER].map((r) => tree(r));
    const b = bookmark(id);
    if (!b) return null;
    return b.kind === 'folder' ? { ...b, children: children(id).map((c) => tree(c.id)) } : b;
  }
  /** Папка с таким названием в родителе (первая) или новая. */
  function folderNamed(parent, title) {
    const f = q("SELECT id FROM bookmarks WHERE parent = ? AND kind = 'folder' AND title = ? ORDER BY position LIMIT 1").get(parent, title);
    return f ? f.id : insert(parent, 'folder', title, null, undefined, Date.now());
  }
  /**
   * Перенос дерева закладок (импорт): [{ title, url } | { title, children }] внутрь папки.
   * Папки с тем же названием сливаются, адрес, уже лежащий в той же папке, не повторяется -
   * повторный импорт ничего не удваивает.
   */
  function importBookmarks(parent, nodes) {
    let added = 0;
    const walk = (into, list) => {
      for (const n of list || []) {
        if (!n) continue;
        if (Array.isArray(n.children)) {
          walk(folderNamed(into, String(n.title || '').slice(0, 500)), n.children);
        } else if (isHistoryUrl(n.url)) {
          const dup = q("SELECT 1 FROM bookmarks WHERE parent = ? AND kind = 'url' AND url = ?").get(into, n.url);
          if (!dup) { insert(into, 'url', n.title, n.url, undefined, n.added); added++; }
        }
      }
    };
    tx(() => walk(parent, nodes));
    return added;
  }
  function bookmarkCount() {
    return q("SELECT COUNT(*) AS n FROM bookmarks WHERE kind = 'url'").get().n;
  }

  // ---------- загрузки ----------
  const dlRow = (r) => ({ id: r.id, url: r.url, filename: r.filename, path: r.path, state: r.state, received: r.received, total: r.total, started: r.started, finished: r.finished, mime: r.mime });
  function addDownload({ url, filename, path, state = 'progressing', received = 0, total = 0, started = Date.now(), mime = '' }) {
    const r = q('INSERT INTO downloads(url, filename, path, state, received, total, started, mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(String(url), String(filename), String(path), state, received, total, Math.floor(started), String(mime || ''));
    return Number(r.lastInsertRowid);
  }
  function updateDownload(id, patch) {
    const d = q('SELECT * FROM downloads WHERE id = ?').get(id);
    if (!d) return null;
    const n = { ...dlRow(d), ...patch };
    q('UPDATE downloads SET filename = ?, path = ?, state = ?, received = ?, total = ?, finished = ? WHERE id = ?')
      .run(n.filename, n.path, n.state, Math.floor(n.received) || 0, Math.floor(n.total) || 0, n.finished == null ? null : Math.floor(n.finished), id);
    return n;
  }
  function listDownloads(limit = 500) {
    return q('SELECT * FROM downloads ORDER BY started DESC, id DESC LIMIT ?').all(limit).map(dlRow);
  }
  function removeDownload(id) {
    q('DELETE FROM downloads WHERE id = ?').run(id);
  }
  /** Убрать из списка всё, кроме загрузок keep (идущих сейчас, в том числе на паузе). */
  function clearDownloads(keep = []) {
    const ids = (keep || []).map(Number).filter(Number.isInteger);
    // «id NOT IN (NULL)» в SQL не истинно ни для кого - без оставляемых удаляется всё
    if (!ids.length) { q('DELETE FROM downloads').run(); return; }
    q(`DELETE FROM downloads WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }

  // ---------- сайты ----------
  function isBlockingOn(site) {
    if (!site) return true;
    const r = q('SELECT blocking FROM sites WHERE site = ?').get(site);
    return !r || r.blocking !== 0;
  }
  function setBlocking(site, on) {
    if (!site) return;
    if (on) q('DELETE FROM sites WHERE site = ?').run(site);
    else q('INSERT INTO sites(site, blocking) VALUES (?, 0) ON CONFLICT(site) DO UPDATE SET blocking = 0').run(site);
  }
  function blockingOffSites() {
    return q('SELECT site FROM sites WHERE blocking = 0 ORDER BY site').all().map((r) => r.site);
  }

  // ---------- значки сайтов (data:, чтобы интерфейсу не ходить в сеть) ----------
  function setFavicon(site, data) {
    if (!site || typeof data !== 'string' || !data.startsWith('data:image/') || data.length > MAX_FAVICON) return false;
    q('INSERT INTO favicons(site, data) VALUES (?, ?) ON CONFLICT(site) DO UPDATE SET data = excluded.data').run(site, data);
    return true;
  }
  function getFavicon(site) {
    const r = q('SELECT data FROM favicons WHERE site = ?').get(site);
    return r ? r.data : null;
  }

  function close() {
    db.close();
  }

  return {
    ROOT_BAR, ROOT_OTHER,
    getSettings, setSettings, getSession, setSession,
    addVisit, setTitle, importHistory, searchHistory, historyCount, getVisit, deleteHistory, deleteHistorySince, clearHistory,
    bookmark, children, addBookmark, addFolder, updateBookmark, moveBookmark, removeBookmark, bookmarksByUrl,
    searchBookmarks, tree, importBookmarks, bookmarkCount,
    addDownload, updateDownload, listDownloads, removeDownload, clearDownloads,
    isBlockingOn, setBlocking, blockingOffSites, setFavicon, getFavicon,
    close,
  };
}

module.exports = { openStore, ROOT_BAR, ROOT_OTHER };
