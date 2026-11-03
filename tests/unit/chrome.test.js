// Законы импорта из Chrome на поддельном профиле со случайными данными.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { src, forAll, ROOT } = require('./law');
const { writeProfile, writeUserData } = require(path.join(ROOT, 'tests', 'fixtures', 'fake-chrome'));

const chrome = src('core/chrome');
const { openStore } = src('core/store');

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const T0 = Date.UTC(2020, 0, 1);

function genNodes(r, depth) {
  return Array.from({ length: r.int(0, depth ? 3 : 6) }, () => (r.bool(0.25) && depth < 3
    ? { title: r.pick(['Работа', 'Игры', 'Dev', '']), children: genNodes(r, depth + 1) }
    : { title: r.pick(['Кот', 'GitHub', '', 'Новости дня']), url: r.bool(0.08) ? r.pick(['chrome://settings/', 'javascript:void(0)']) : `https://${r.str(LETTERS, 2, 6)}.${r.pick(['com', 'ru'])}/${r.str(LETTERS, 0, 4)}`, added: T0 + r.int(0, 1e10) }));
}

function genProfile(r) {
  const seen = new Set();
  const history = [];
  for (let i = r.int(0, 40); i > 0; i--) {
    const url = r.bool(0.05) ? 'chrome://newtab/' : `https://${r.str(LETTERS, 1, 5)}.${r.pick(['com', 'org'])}/${r.str(LETTERS, 0, 5)}`;
    if (seen.has(url)) continue;
    seen.add(url);
    history.push({ url, title: r.pick(['', 'Главная', 'Docs', 'Видео']), visits: r.int(0, 30), lastVisit: T0 + r.int(0, 1e11), hidden: r.bool(0.1) });
  }
  return { bar: genNodes(r, 0), other: r.bool() ? genNodes(r, 1) : [], synced: r.bool(0.3) ? genNodes(r, 2) : [], history };
}

function hashDir(dir) {
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(dir).sort()) {
    const st = fs.statSync(path.join(dir, f));
    h.update(f).update(String(st.mtimeMs)).update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest('hex');
}

function flatUrls(nodes, prefix, out) {
  for (const n of nodes) {
    if (n.children) flatUrls(n.children, `${prefix}/${n.title}`, out);
    else if (/^https?:/.test(n.url)) out.add(`${prefix} ${n.url}`);
  }
  return out;
}

function storeUrls(store, id, prefix, out) {
  for (const c of store.children(id)) {
    if (c.kind === 'folder') storeUrls(store, c.id, `${prefix}/${c.title}`, out);
    else out.add(`${prefix} ${c.url}`);
  }
  return out;
}

test('закон: всё из поддельного профиля перенесено, повтор не удваивает, профиль не тронут', () => {
  forAll('chrome-import', genProfile, (p) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-fake-chrome-'));
    writeProfile(dir, p);
    const before = hashDir(dir);
    const store = openStore();
    const names = { other: 'Другие', synced: 'Мобильные' };
    const res = chrome.importProfile(store, dir, { folderTitle: 'Из Chrome', names });
    assert.equal(hashDir(dir), before, 'файлы профиля не изменились');
    const folder = store.children(store.ROOT_BAR).find((b) => b.title === 'Из Chrome');
    const want = flatUrls(p.bar, '', new Set());
    if (p.other.length) flatUrls(p.other, `/${names.other}`, want);
    if (p.synced.length) flatUrls(p.synced, `/${names.synced}`, want);
    const got = storeUrls(store, folder.id, '', new Set());
    assert.deepEqual([...got].sort(), [...want].sort());
    const visible = p.history.filter((h) => !h.hidden && h.url.startsWith('https:'));
    assert.equal(store.historyCount(), visible.length);
    for (const h of visible) {
      const v = store.getVisit(h.url);
      assert.equal(v.lastVisit, h.lastVisit, 'время Chrome переведено верно');
      assert.equal(v.visits, Math.max(1, h.visits));
      assert.equal(v.title, h.title);
    }
    assert.equal(res.history, visible.length);
    const snap = JSON.stringify(store.tree());
    const again = chrome.importProfile(store, dir, { folderTitle: 'Из Chrome', names });
    assert.equal(again.bookmarks, 0);
    assert.equal(JSON.stringify(store.tree()), snap);
    assert.equal(store.historyCount(), visible.length);
    assert.equal(hashDir(dir), before);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60);
});

test('закон: время Chrome (микросекунды с 1601 года) туда-обратно', () => {
  forAll('webkit-time', (r) => r.int(0, 4e12), (ms) => {
    assert.equal(chrome.webkitToMs(chrome.msToWebkit(ms)), ms);
    assert.equal(chrome.webkitToMs(String(chrome.msToWebkit(ms) + 999n)), ms);
  }, 1000);
  assert.equal(chrome.webkitToMs('13350000000000000') > 0, true);
  assert.equal(chrome.webkitToMs(0), 0);
  assert.equal(chrome.webkitToMs('мусор'), 0);
  assert.equal(chrome.msToWebkit(0), BigInt(chrome.EPOCH_DIFF_MS) * 1000n);
  assert.equal(chrome.webkitToMs(13350000000123456), 1705526400123);
  assert.equal(chrome.webkitToMs(-5n), 0);
  assert.equal(chrome.webkitToMs(NaN), 0);
});

test('история читается, пока Chrome держит базу открытой и заблокированной', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-fake-chrome-'));
  writeProfile(dir, { history: [{ url: 'https://a.com/', title: 'A', visits: 2, lastVisit: T0 }] });
  const live = new DatabaseSync(path.join(dir, 'History'));
  live.exec('BEGIN EXCLUSIVE; UPDATE urls SET title = title;');
  fs.writeFileSync(path.join(dir, 'History-journal'), '');
  try {
    assert.deepEqual(chrome.readHistory(dir), [{ url: 'https://a.com/', title: 'A', visits: 2, lastVisit: T0 }]);
  } finally {
    live.exec('ROLLBACK');
    live.close();
  }
  assert.equal(chrome.readHistory(path.join(dir, 'нет')), null);
  assert.equal(chrome.readBookmarks(dir), null);
  fs.writeFileSync(path.join(dir, 'Bookmarks'), '{"roots": 5}');
  assert.deepEqual(chrome.readBookmarks(dir), []);
  fs.writeFileSync(path.join(dir, 'Bookmarks'), 'null');
  assert.deepEqual(chrome.readBookmarks(dir), []);
  fs.writeFileSync(path.join(dir, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [null, { type: 'x' }, { name: 'f', children: [{ type: 'url', url: 'https://b.com/' }] }] }, other: { children: [{ type: 'url', url: 'https://c.com/', name: 'C' }] } } }));
  assert.deepEqual(chrome.readBookmarks(dir), [{ title: 'f', children: [{ title: '', url: 'https://b.com/', added: 0 }] }, { title: 'Other bookmarks', children: [{ title: 'C', url: 'https://c.com/', added: 0 }] }]);
  const store = openStore();
  assert.deepEqual(chrome.importProfile(store, path.join(dir, 'нет')), { bookmarks: 0, history: 0, foundBookmarks: false, foundHistory: false });
  store.close();
});

test('профили: Local State, имена папок, порядок, где искать на разных системах', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-userdata-'));
  writeUserData(root, { 'Profile 10': { bar: [] }, 'Profile 2': { history: [] }, Default: { bar: [] }, 'System Profile': { bar: [] } }, { Default: 'Алексей', 'Profile 2': '' });
  fs.mkdirSync(path.join(root, 'Profile 3'));
  fs.writeFileSync(path.join(root, 'Profile 4'), 'файл, не папка');
  const list = chrome.listProfiles(root);
  assert.deepEqual(list.map((p) => [p.dir, p.name, p.hasBookmarks, p.hasHistory]), [['Default', 'Алексей', true, false], ['Profile 2', 'Profile 2', false, true], ['Profile 10', 'Profile 10', true, false]]);
  fs.writeFileSync(path.join(root, 'Local State'), 'испорчен');
  assert.equal(chrome.listProfiles(root)[0].name, 'Default');
  assert.deepEqual(chrome.listProfiles(path.join(root, 'нет')), []);
  assert.deepEqual(chrome.findProfiles({ env: { IB_CHROME_DIR: root } }).map((p) => p.root), [root, root, root]);
  const win = chrome.chromeRoots({ platform: 'win32', env: { LOCALAPPDATA: 'X:\\Local' }, home: 'X:\\h' });
  assert.equal(win[0], 'X:\\Local\\Google\\Chrome\\User Data');
  assert.equal(chrome.chromeRoots({ platform: 'win32', env: {}, home: 'H' })[0].endsWith('Google\\Chrome\\User Data'), true);
  assert.equal(chrome.chromeRoots({ platform: 'darwin', env: {}, home: '/Users/u' })[0], '/Users/u/Library/Application Support/Google/Chrome');
  assert.equal(chrome.chromeRoots({ platform: 'linux', env: {}, home: '/home/u' })[0], '/home/u/.config/google-chrome');
  assert.equal(chrome.chromeRoots({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' }, home: '/home/u' })[2], '/x/chromium');
  assert.ok(chrome.chromeRoots().length >= 1);
});
