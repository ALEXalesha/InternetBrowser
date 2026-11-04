// Законы хранилища: туда-обратно через файл, поиск, удаление, дерево закладок против модели.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { src, forAll } = require('./law');

const { openStore, ROOT_BAR, ROOT_OTHER } = src('core/store');
const { normalizeSettings, DEFAULTS, resolveLang, MAX_LINKS } = src('core/settings');
const { THEMES, isDark, normalizeTheme } = src('core/themes');
const { siteOf, isHistoryUrl } = src('core/sites');

const WORDS = ['кот', 'Кот', 'dog', 'news', 'git', 'Hub', 'ёж', 'проект', 'test', 'a'];

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-store-'));
  return path.join(dir, 'profile.sqlite');
}

function genUrl(r) {
  return `https://${r.pick(['a', 'b', 'c', 'git', 'news'])}.${r.pick(['com', 'ru', 'org'])}/${r.pick(WORDS)}/${r.int(0, 6)}`;
}

test('закон: история туда-обратно через файл - визиты, время и заголовок', () => {
  forAll('history-roundtrip', (r) => Array.from({ length: r.int(0, 60) }, () => ({
    url: r.bool(0.1) ? r.pick(['ib://newtab/', 'about:blank', 'data:text/plain,x', 'javascript:1']) : genUrl(r),
    title: r.bool(0.3) ? '' : `${r.pick(WORDS)} ${r.pick(WORDS)}`,
    time: r.int(1, 1e12),
  })), (visits) => {
    const file = tmpFile();
    const s = openStore(file);
    const model = new Map();
    for (const v of visits) {
      const ok = s.addVisit(v.url, v.title, v.time);
      assert.equal(ok, isHistoryUrl(v.url));
      if (!ok) continue;
      const m = model.get(v.url) || { visits: 0, lastVisit: 0, title: '' };
      model.set(v.url, { visits: m.visits + 1, lastVisit: Math.max(m.lastVisit, v.time), title: v.title || m.title });
    }
    s.close();
    const t = openStore(file);
    assert.equal(t.historyCount(), model.size);
    for (const [url, m] of model) assert.deepEqual(t.getVisit(url), { url, ...m });
    t.close();
  }, 60);
});

test('закон: поиск по истории находит всё подходящее и только его, свежие сверху', () => {
  forAll('history-search', (r) => ({
    visits: Array.from({ length: r.int(0, 50) }, () => ({ url: genUrl(r), title: `${r.pick(WORDS)} ${r.pick(WORDS)}`, time: r.int(1, 1e6) })),
    query: r.pick(['', ' ', 'кот', 'КОТ', 'ёж кот', 'git', 'hub git', 'com', 'нет-такого', 'a']),
  }), ({ visits, query }) => {
    const s = openStore();
    for (const v of visits) s.addVisit(v.url, v.title, v.time);
    const got = s.searchHistory(query, 1000);
    const w = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = s.searchHistory('', 1000);
    const want = all.filter((e) => w.every((x) => `${e.url} ${e.title}`.toLowerCase().includes(x)));
    assert.deepEqual(got.map((e) => e.url), want.map((e) => e.url));
    for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].lastVisit >= got[i].lastVisit);
    s.close();
  }, 150);
});

test('закон: удаление из истории убирает ровно выбранное', () => {
  forAll('history-delete', (r) => ({
    urls: Array.from({ length: r.int(1, 30) }, () => genUrl(r)),
    pick: r.int(0, 1e9),
  }), ({ urls, pick }) => {
    const s = openStore();
    urls.forEach((u, i) => s.addVisit(u, 't', i + 1));
    const uniq = [...new Set(urls)];
    const gone = uniq.filter((_, i) => (pick >> (i % 30)) & 1);
    s.deleteHistory(gone);
    assert.deepEqual(new Set(s.searchHistory('', 1000).map((e) => e.url)), new Set(uniq.filter((u) => !gone.includes(u))));
    s.close();
  }, 100);
});

test('история: время, заголовок, импорт без удвоения и очистка', () => {
  const s = openStore();
  s.addVisit('https://a.com/', 'A', 10);
  s.addVisit('https://b.com/', '', 20);
  s.setTitle('https://b.com/', 'Би');
  s.setTitle('https://b.com/', '');
  assert.equal(s.getVisit('https://b.com/').title, 'Би');
  assert.equal(s.getVisit('https://nope/'), null);
  const imp = [{ url: 'https://a.com/', title: 'X', visits: 5, lastVisit: 5 }, { url: 'https://c.com/', title: 'C', visits: 0, lastVisit: 30 }, { url: 'ib://x/' }, null];
  assert.equal(s.importHistory(imp), 2);
  assert.equal(s.importHistory(imp), 2);
  assert.deepEqual(s.getVisit('https://a.com/'), { url: 'https://a.com/', title: 'A', visits: 5, lastVisit: 10 });
  assert.deepEqual(s.getVisit('https://c.com/'), { url: 'https://c.com/', title: 'C', visits: 1, lastVisit: 30 });
  assert.equal(s.importHistory(null), 0);
  s.deleteHistorySince(15);
  assert.deepEqual(s.searchHistory().map((e) => e.url), ['https://a.com/']);
  s.clearHistory();
  assert.equal(s.historyCount(), 0);
  s.close();
});

// Модель дерева закладок: id -> { parent, kind, title, url, kids: [id] }
function snapshot(s) {
  const out = [];
  const walk = (n, depth) => {
    out.push([depth, n.kind, n.title, n.url || null, n.position]);
    if (n.children) n.children.forEach((c, i) => { assert.equal(c.position, i, 'позиции в папке подряд с нуля'); walk(c, depth + 1); });
  };
  s.tree().forEach((root) => walk(root, 0));
  return out;
}

function modelSnapshot(model) {
  const out = [];
  const walk = (id, depth, pos) => {
    const n = model.get(id);
    out.push([depth, n.kind, n.title, n.url || null, pos]);
    if (n.kind === 'folder') n.kids.forEach((k, i) => walk(k, depth + 1, i));
  };
  walk(ROOT_BAR, 0, 0);
  walk(ROOT_OTHER, 0, 1);
  return out;
}

function inside(model, id, folder) {
  for (let cur = folder; cur != null; cur = model.get(cur).parent) if (cur === id) return true;
  return false;
}

test('закон: дерево закладок после случайных действий совпадает с моделью и переживает перезапуск', () => {
  forAll('bookmarks-model', (r) => Array.from({ length: r.int(1, 40) }, () => ({
    op: r.pick(['add', 'add', 'folder', 'move', 'move', 'remove', 'update']),
    a: r.int(0, 1e6), b: r.int(0, 1e6), pos: r.bool(0.3) ? undefined : r.int(-2, 12), title: `${r.pick(WORDS)}${r.int(0, 9)}`, url: genUrl(r),
  })), (ops) => {
    const file = tmpFile();
    const s = openStore(file);
    const model = new Map([[ROOT_BAR, { parent: null, kind: 'folder', title: 'bar', kids: [] }], [ROOT_OTHER, { parent: null, kind: 'folder', title: 'other', kids: [] }]]);
    const ids = () => [...model.keys()];
    const folders = () => ids().filter((i) => model.get(i).kind === 'folder');
    const clamp = (pos, n) => (Number.isInteger(pos) ? Math.max(0, Math.min(n, pos)) : n);
    for (const o of ops) {
      if (o.op === 'add' || o.op === 'folder') {
        const parent = folders()[o.a % folders().length];
        const id = o.op === 'add' ? s.addBookmark({ parent, title: o.title, url: o.url, position: o.pos }) : s.addFolder({ parent, title: o.title, position: o.pos });
        const kids = model.get(parent).kids;
        kids.splice(clamp(o.pos, kids.length), 0, id);
        model.set(id, o.op === 'add' ? { parent, kind: 'url', title: o.title, url: o.url } : { parent, kind: 'folder', title: o.title, kids: [] });
      } else if (o.op === 'move') {
        const id = ids()[o.a % model.size];
        const to = folders()[o.b % folders().length];
        const can = model.get(id).parent !== null && !inside(model, id, to);
        assert.equal(s.moveBookmark(id, to, o.pos), can);
        if (can) {
          const n = model.get(id);
          const from = model.get(n.parent).kids;
          from.splice(from.indexOf(id), 1);
          const kids = model.get(to).kids;
          kids.splice(clamp(o.pos, kids.length), 0, id);
          n.parent = to;
        }
      } else if (o.op === 'remove') {
        const id = ids()[o.a % model.size];
        const n = model.get(id);
        assert.equal(s.removeBookmark(id), n.parent !== null);
        if (n.parent !== null) {
          const kids = model.get(n.parent).kids;
          kids.splice(kids.indexOf(id), 1);
          const drop = (x) => { const m = model.get(x); if (m.kind === 'folder') m.kids.forEach(drop); model.delete(x); };
          drop(id);
        }
      } else {
        const id = ids()[o.a % model.size];
        const n = model.get(id);
        assert.equal(s.updateBookmark(id, { title: o.title, url: o.url }), n.parent !== null);
        if (n.parent !== null) { n.title = o.title; if (n.kind === 'url') n.url = o.url; }
      }
      assert.deepEqual(snapshot(s), modelSnapshot(model));
    }
    s.close();
    const t = openStore(file);
    assert.deepEqual(snapshot(t), modelSnapshot(model));
    t.close();
  }, 80);
});

function genTree(r, depth) {
  return Array.from({ length: r.int(0, depth > 2 ? 2 : 6) }, () => (r.bool(0.3) && depth < 4
    ? { title: r.pick(['Работа', 'Игры', 'Новости']), children: genTree(r, depth + 1) }
    : { title: r.pick(WORDS), url: r.bool(0.05) ? 'javascript:alert(1)' : genUrl(r) }));
}

test('закон: импорт дерева закладок дважды не удваивает ничего', () => {
  forAll('bookmarks-import-twice', (r) => genTree(r, 0), (nodes) => {
    const s = openStore();
    const folder = s.addFolder({ title: 'Из Chrome' });
    s.importBookmarks(folder, nodes);
    const once = snapshot(s);
    assert.equal(s.importBookmarks(folder, nodes), 0);
    assert.deepEqual(snapshot(s), once);
    const urls = new Set();
    const walk = (list) => list.forEach((n) => (n.children ? walk(n.children) : isHistoryUrl(n.url) && urls.add(n.url)));
    walk(nodes);
    for (const u of urls) assert.ok(s.bookmarksByUrl(u).length >= 1);
    s.close();
  }, 150);
});

test('закладки: ошибки и поиск', () => {
  const s = openStore();
  assert.throws(() => s.addBookmark({ url: 'javascript:1' }));
  assert.throws(() => s.addBookmark({ parent: 999, url: 'https://a.com/' }));
  const id = s.addBookmark({ title: 'Кот', url: 'https://cats.ru/' });
  assert.throws(() => s.addBookmark({ parent: id, url: 'https://a.com/' }));
  assert.equal(s.addBookmark({ url: 'https://other.org/', parent: ROOT_OTHER }) > 0, true);
  assert.equal(s.updateBookmark(id, { url: 'javascript:1' }), false);
  assert.equal(s.updateBookmark(ROOT_BAR, { title: 'x' }), false);
  assert.equal(s.updateBookmark(id), true);
  assert.equal(s.moveBookmark(ROOT_BAR, ROOT_OTHER), false);
  assert.equal(s.moveBookmark(id, id), false);
  assert.equal(s.removeBookmark(12345), false);
  assert.equal(s.tree(777), null);
  assert.deepEqual(s.searchBookmarks('кот').map((b) => b.url), ['https://cats.ru/']);
  assert.equal(s.searchBookmarks('').length, 2);
  assert.equal(s.bookmarkCount(), 2);
  assert.equal(s.bookmark(id).title, 'Кот');
  assert.equal(s.children(ROOT_BAR).length, 1);
  assert.equal(s.importBookmarks(ROOT_OTHER, [null, { title: 'f', children: [{ url: 'https://z.com/' }] }]), 1);
  s.close();
});

test('закон: настройки - любой мусор даёт допустимые, приведение идемпотентно, туда-обратно через файл', () => {
  const junk = [null, 1, 'x', true, {}, [], { a: 1 }, -1, 'glass', 'ru', [{ url: 'https://a.com' }]];
  forAll('settings', (r) => {
    const o = {};
    for (const k of ['lang', 'theme', 'engine', 'blocking', 'cosmetic', 'listsAutoUpdate', 'bookmarksBar', 'restoreTabs', 'links', 'zzz']) {
      if (r.bool(0.6)) o[k] = r.pick([...junk, r.pick(['ru', 'en', 'auto', 'light', 'night', 'warm', 'formal', 'google', 'yandex', false, true])]);
    }
    if (r.bool(0.3)) o.links = Array.from({ length: r.int(0, 20) }, () => r.pick([null, { url: 'ftp://x' }, { url: 'https://a.com/x', title: r.pick(['', ' ', 'A', 5]) }, { url: 'https://bad host/' }, { url: 'https://[zz]/' }]));
    return r.bool(0.1) ? r.pick(junk) : o;
  }, (raw) => {
    const n = normalizeSettings(raw);
    assert.deepEqual(normalizeSettings(n), n);
    for (const k of ['blocking', 'cosmetic', 'listsAutoUpdate', 'bookmarksBar', 'restoreTabs']) assert.equal(typeof n[k], 'boolean', k);
    assert.ok(['auto', 'ru', 'en'].includes(n.lang));
    assert.ok(THEMES.some((t) => t.id === n.theme));
    assert.equal(typeof n.engine, 'string');
    assert.deepEqual(Object.keys(n).sort(), Object.keys(DEFAULTS).sort());
    assert.ok(n.links.length <= MAX_LINKS);
    for (const l of n.links) assert.ok(/^https?:/.test(l.url) && l.title);
    const s = openStore();
    assert.deepEqual(s.setSettings(raw && typeof raw === 'object' ? raw : {}), normalizeSettings({ ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }));
    s.close();
  }, 400);
  const file = tmpFile();
  const s = openStore(file);
  s.setSettings({ theme: 'light', lang: 'en' });
  s.setSession(['https://a.com/', 5, 'ib://newtab/']);
  s.close();
  const t = openStore(file);
  assert.equal(t.getSettings().theme, 'light');
  assert.deepEqual(t.getSession(), ['https://a.com/', 'ib://newtab/']);
  t.setSession(null);
  assert.deepEqual(t.getSession(), []);
  t.close();
});

test('язык и темы', () => {
  assert.equal(resolveLang('auto', 'ru-RU'), 'ru');
  assert.equal(resolveLang('auto', 'uk'), 'ru');
  assert.equal(resolveLang('auto', 'de-DE'), 'en');
  assert.equal(resolveLang('auto', undefined), 'en');
  assert.equal(resolveLang('en', 'ru'), 'en');
  assert.equal(THEMES.length, 5);
  assert.equal(isDark('light'), false);
  assert.equal(isDark('???'), true);
  assert.equal(normalizeTheme('warm'), 'warm');
});

test('закон: выключатель блокировки по сайтам совпадает с моделью и переживает перезапуск', () => {
  forAll('sites', (r) => Array.from({ length: r.int(0, 40) }, () => ({ site: r.pick(['a.com', 'b.ru', 'c.org', 'x.test', '']), on: r.bool() })), (ops) => {
    const file = tmpFile();
    const s = openStore(file);
    const off = new Set();
    for (const o of ops) {
      s.setBlocking(o.site, o.on);
      if (o.site) { if (o.on) off.delete(o.site); else off.add(o.site); }
    }
    s.close();
    const t = openStore(file);
    for (const site of ['a.com', 'b.ru', 'c.org', 'x.test']) assert.equal(t.isBlockingOn(site), !off.has(site));
    assert.equal(t.isBlockingOn(''), true);
    assert.deepEqual(t.blockingOffSites(), [...off].sort());
    t.close();
  }, 80);
});

test('сайт по адресу и что идёт в историю', () => {
  assert.equal(siteOf('https://WWW.Example.com/a'), 'example.com');
  assert.equal(siteOf('http://sub.example.com'), 'sub.example.com');
  assert.equal(siteOf('ib://newtab/'), null);
  assert.equal(siteOf('мусор'), null);
  assert.equal(isHistoryUrl('file:///C:/a.html'), true);
  assert.equal(isHistoryUrl('мусор'), false);
});

test('загрузки и значки', () => {
  const s = openStore();
  const a = s.addDownload({ url: 'https://a.com/f.zip', filename: 'f.zip', path: '/d/f.zip', started: 1 });
  const b = s.addDownload({ url: 'https://a.com/g.zip', filename: 'g.zip', path: '/d/g.zip', started: 2, mime: null });
  assert.deepEqual(s.listDownloads().map((d) => d.id), [b, a]);
  assert.equal(s.updateDownload(a, { state: 'completed', received: 10, total: 10, finished: 3 }).state, 'completed');
  assert.equal(s.updateDownload(999, {}), null);
  s.updateDownload(b, { received: 'x' });
  s.clearDownloads();
  assert.deepEqual(s.listDownloads().map((d) => d.id), [b]);
  s.removeDownload(b);
  assert.deepEqual(s.listDownloads(), []);
  assert.equal(s.setFavicon('a.com', 'data:image/png;base64,AA=='), true);
  assert.equal(s.setFavicon('a.com', 'https://a.com/favicon.ico'), false);
  assert.equal(s.setFavicon('', 'data:image/png;base64,AA=='), false);
  assert.equal(s.getFavicon('a.com'), 'data:image/png;base64,AA==');
  assert.equal(s.getFavicon('b.com'), null);
  s.close();
});
