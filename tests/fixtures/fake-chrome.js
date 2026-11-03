// Поддельный профиль Chrome для законов импорта: папка «User Data» с Local State, профилями,
// файлом Bookmarks (как у Chrome, JSON с roots) и базой History (таблицы urls и visits).
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const EPOCH_DIFF_MS = 11644473600000;
const toWebkit = (ms) => (BigInt(ms) + BigInt(EPOCH_DIFF_MS)) * 1000n;

let nextId = 1;
function chromeNode(n) {
  const id = String(nextId++);
  if (n.children) return { children: n.children.map(chromeNode), date_added: String(toWebkit(n.added || 0)), id, name: n.title, type: 'folder' };
  return { date_added: String(toWebkit(n.added || 0)), id, name: n.title, type: 'url', url: n.url };
}

/**
 * profile: { bar: [nodes], other: [nodes], synced: [nodes], history: [{ url, title, visits, lastVisit, hidden }] }
 * nodes: { title, url, added } | { title, children }
 */
function writeProfile(dir, profile) {
  fs.mkdirSync(dir, { recursive: true });
  if (profile.bar || profile.other || profile.synced) {
    const root = (name, list) => ({ children: (list || []).map(chromeNode), date_added: '0', id: String(nextId++), name, type: 'folder' });
    const data = { checksum: '0', roots: { bookmark_bar: root('Bookmarks bar', profile.bar), other: root('Other bookmarks', profile.other), synced: root('Mobile bookmarks', profile.synced) }, version: 1 };
    fs.writeFileSync(path.join(dir, 'Bookmarks'), JSON.stringify(data, null, 3));
  }
  if (profile.history) {
    const db = new DatabaseSync(path.join(dir, 'History'));
    db.exec(`CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL,
        typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
      CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER NOT NULL, visit_time INTEGER NOT NULL, from_visit INTEGER, transition INTEGER DEFAULT 0 NOT NULL);
      INSERT INTO meta VALUES ('version', '70');`);
    const ins = db.prepare('INSERT INTO urls(url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)');
    const vis = db.prepare('INSERT INTO visits(url, visit_time) VALUES (?, ?)');
    for (const h of profile.history) {
      const r = ins.run(h.url, h.title, h.visits, toWebkit(h.lastVisit), h.hidden ? 1 : 0);
      vis.run(r.lastInsertRowid, toWebkit(h.lastVisit));
    }
    db.close();
  }
}

/** «User Data» с несколькими профилями: { 'Default': profile, 'Profile 1': profile }, имена в Local State. */
function writeUserData(root, profiles, names = {}) {
  fs.mkdirSync(root, { recursive: true });
  const info = {};
  for (const [dir, p] of Object.entries(profiles)) {
    writeProfile(path.join(root, dir), p);
    if (names[dir]) info[dir] = { name: names[dir] };
  }
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: info } }));
}

module.exports = { writeProfile, writeUserData, toWebkit };
