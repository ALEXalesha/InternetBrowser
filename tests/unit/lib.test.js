// Законы модулей главного процесса без окон: протокол ib://, менеджер загрузок на подделке
// объекта загрузки Electron, разрешения сайтов, подсказки адресной строки из хранилища.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { src, forAll, ROOT } = require('./law');

const protocol = src('lib/protocol');
const { createDownloads } = src('lib/downloads');
const { createPermissions } = src('lib/permissions');
const { suggestions } = src('lib/omnisource');
const { openStore } = src('core/store');

const SRC = path.join(ROOT, 'src');
const SEG = ['..', '.', 'ui', 'pages', 'core', 'main', 'index.html', '%2e%2e', '%2F', 'a', '..%2f', '%00', '%E0%A4%A', 'newtab.html', 'package.json', '~', 'C:', '\\'];

test('закон: адрес ib:// никогда не выводит за папки ui и pages (и единственный файл ядра)', () => {
  forAll('protocol-traversal', (r) => `ib://${r.pick(['ui', 'newtab', 'settings', 'core', 'evil', 'history'])}/${Array.from({ length: r.int(0, 6) }, () => r.pick(SEG)).join(r.pick(['/', '\\', '/']))}`, (url) => {
    const f = protocol.fileFor(url);
    if (f === null) return;
    const inside = [path.join(SRC, 'ui'), path.join(SRC, 'pages')].some((d) => !path.relative(d, f).startsWith('..') && !path.isAbsolute(path.relative(d, f)));
    assert.ok(inside || f === path.join(SRC, 'core', 'i18n.js'), f);
  }, 2000);
});

test('протокол ib://: страницы, файлы, 404 и строгий CSP', async () => {
  assert.equal(protocol.fileFor('ib://ui/'), path.join(SRC, 'ui', 'index.html'));
  assert.equal(protocol.fileFor('ib://settings/'), path.join(SRC, 'pages', 'settings.html'));
  assert.equal(protocol.fileFor('ib://history/page.css'), path.join(SRC, 'pages', 'page.css'));
  assert.equal(protocol.fileFor('ib://core/i18n.js'), path.join(SRC, 'core', 'i18n.js'));
  assert.equal(protocol.fileFor('ib://core/store.js'), null);
  assert.equal(protocol.fileFor('ib://ui/../main/main.js'), path.join(SRC, 'ui', 'main', 'main.js'));
  assert.equal(protocol.fileFor('ib://ui/%2e%2e/main/main.js'), path.join(SRC, 'ui', 'main', 'main.js'), 'URL сам сворачивает %2e%2e внутри адреса');
  assert.equal(protocol.fileFor('https://a.com/'), null);
  assert.equal(protocol.fileFor('не адрес'), null);
  assert.equal(protocol.fileFor('ib://ui/%E0%A4%A'), null);
  const ok = protocol.respond('ib://newtab/');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(ok.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(ok.headers.get('content-security-policy'), /img-src ib: data:;/);
  assert.match(await ok.text(), /<html/);
  assert.equal(protocol.respond('ib://ui/icons.js').headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(protocol.respond('ib://ui/themes.css').headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(protocol.respond('ib://ui/нет.js').status, 404);
  assert.equal(protocol.respond('ib://evil/').status, 404);
  let installed = null;
  protocol.install({ protocol: { handle: (scheme, fn) => { installed = [scheme, fn]; } } });
  assert.equal(installed[0], 'ib');
  assert.equal(installed[1]({ url: 'ib://ui/' }).status, 200);
});

function fakeItem(name, total) {
  const e = new EventEmitter();
  let paused = false;
  let received = 0;
  return Object.assign(e, {
    savePath: null,
    getFilename: () => name, getURL: () => `https://a.com/${name}`, getTotalBytes: () => total, getMimeType: () => 'application/zip',
    getReceivedBytes: () => received, isPaused: () => paused, canResume: () => paused,
    setSavePath(p) { this.savePath = p; },
    pause() { paused = true; }, resume() { paused = false; }, cancel() { e.emit('done', {}, 'cancelled'); },
    progress(n) { received = n; e.emit('updated', {}, 'progressing'); },
    finish() { received = total; e.emit('done', {}, 'completed'); },
  });
}

test('закон: одновременные загрузки с одним именем ложатся в папку под разными именами', () => {
  forAll('downloads-manager', (r) => Array.from({ length: r.int(1, 12) }, () => ({ name: r.pick(['a.zip', 'a.zip', 'b.pdf', '../evil.exe', 'CON']), done: r.bool(0.6) })), (list) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-dl-'));
    const store = openStore();
    let t = 0;
    const m = createDownloads({ store, dir: () => dir, now: () => (t += 1000) });
    const paths = [];
    for (const d of list) {
      const item = fakeItem(d.name, 100);
      m.track(item);
      assert.equal(path.dirname(item.savePath), dir);
      paths.push(item.savePath);
      if (d.done) { fs.writeFileSync(item.savePath, 'x'); item.finish(); }
    }
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(m.active(), list.filter((d) => !d.done).length);
    store.close();
  }, 100);
});

test('менеджер загрузок: ход, пауза, отмена, пропавший файл, удаление из списка', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-dl-'));
  const store = openStore();
  let now = 0;
  const changes = [];
  const m = createDownloads({ store, dir: () => dir, now: () => now, onChange: (id) => changes.push(id) });
  const a = fakeItem('a.zip', 100);
  const id = m.track(a);
  now = 1000; a.progress(10);
  now = 1100; a.progress(20);
  assert.equal(store.listDownloads()[0].received, 10, 'обновления чаще 250 мс пропускаются');
  assert.equal(m.act(id, 'pause'), true);
  assert.equal(m.list()[0].state, 'paused');
  assert.equal(m.act(id, 'pause'), false);
  assert.equal(m.act(id, 'resume'), true);
  assert.equal(m.act(id, 'resume'), false);
  assert.equal(m.act(id, 'remove'), false, 'идущую загрузку из списка не убрать');
  assert.equal(m.act(id, 'jump'), false);
  now = 2000; a.progress(50);
  assert.equal(m.list()[0].state, 'progressing');
  assert.equal(m.act(id, 'cancel'), true);
  assert.equal(m.list()[0].state, 'cancelled');
  assert.equal(m.act(id, 'cancel'), false);
  const b = fakeItem('b.zip', 5);
  const idb = m.track(b);
  fs.writeFileSync(b.savePath, 'x');
  b.finish();
  assert.equal(m.list().find((d) => d.id === idb).state, 'completed');
  fs.rmSync(b.savePath);
  assert.equal(m.list().find((d) => d.id === idb).state, 'missing');
  assert.equal(m.act(idb, 'remove'), true);
  const stale = store.addDownload({ url: 'https://x/', filename: 'x', path: path.join(dir, 'x') });
  assert.equal(m.list().find((d) => d.id === stale).state, 'interrupted', 'загрузка прошлого запуска не может идти');
  assert.ok(changes.length > 5);
  createDownloads({ store, dir: () => dir });
  store.close();
});

test('закон: разрешение спрашивается один раз на сайт, безвредное - сразу, без сайта и неизвестное - отказ', async () => {
  const perms = ['media', 'notifications', 'geolocation', 'midi', 'midiSysex', 'fullscreen', 'clipboard-sanitized-write', 'openExternal', 'unknown'];
  const urls = ['https://a.com/x', 'https://www.a.com/', 'http://b.org/', 'ib://settings/', 'file:///x.html'];
  const r = require(path.join(ROOT, 'tests', 'unit', 'law.js')).rng(7);
  const asked = [];
  const p = createPermissions({ ask: async (site, perm) => { asked.push(`${site} ${perm}`); return site === 'a.com'; } });
  for (let i = 0; i < 300; i++) {
    const url = r.pick(urls);
    const perm = r.pick(perms);
    const ok = await p.request(url, perm);
    if (perm === 'fullscreen' || perm === 'clipboard-sanitized-write') assert.equal(ok, true);
    else if (!/^https?:/.test(url) || perm === 'openExternal' || perm === 'unknown') assert.equal(ok, false);
    else assert.equal(ok, url.includes('a.com'));
  }
  assert.equal(new Set(asked).size, asked.length, 'один вопрос на сайт и разрешение');
  assert.equal(p.check('https://a.com/', 'media'), asked.includes('a.com media'));
  assert.equal(p.check('https://b.org/', 'media'), false);
  assert.equal(p.check('ib://x/', 'media'), false);
  assert.equal(p.check('ib://x/', 'fullscreen'), true);
  p.forget();
  assert.equal(p.check('https://a.com/', 'media'), false);
  const broken = createPermissions({ ask: async () => { throw new Error('окно закрыто'); } });
  assert.equal(await broken.request('https://a.com/', 'media'), false);
});

test('подсказки из хранилища: первая строка - что будет по Enter, закладка помечена, без повторов', () => {
  const s = openStore();
  s.addVisit('https://github.com/ALEXalesha', 'ALEXalesha · GitHub', Date.now());
  s.addVisit('https://github.com/', 'GitHub', Date.now() - 1000);
  s.addBookmark({ title: 'GitHub', url: 'https://github.com/' });
  s.addBookmark({ title: 'GitHub Docs', url: 'https://docs.github.com/' });
  assert.deepEqual(suggestions(s, '  ', 'duckduckgo'), []);
  const a = suggestions(s, 'github', 'duckduckgo');
  assert.equal(a[0].type, 'search');
  assert.equal(a[0].title, 'github');
  assert.deepEqual(a.slice(1).map((x) => x.type).sort(), ['bookmark', 'bookmark', 'history']);
  assert.equal(new Set(a.map((x) => x.url)).size, a.length);
  const b = suggestions(s, 'github.com', 'duckduckgo');
  assert.deepEqual(b[0], { type: 'open', url: 'https://github.com/', title: '' });
  assert.ok(!b.slice(1).some((x) => x.url === 'https://github.com/'));
  s.close();
});

const { readIcon, iconCache } = src('lib/favicon');

function fakeResponse({ status = 200, type = 'image/png', length, chunks = [Buffer.from('PNG')], hang = false }) {
  const headers = new Map([['content-type', type]]);
  if (length !== undefined) headers.set('content-length', String(length));
  let read = 0;
  return {
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers.get(k) ?? null },
    body: (async function* gen() {
      for (const c of chunks) { read += c.length; yield c; }
      if (hang) await new Promise(() => {});
    })(),
    read: () => read,
  };
}

test('закон: значок читается не больше предела, со сроком и только картинкой; куки не отправляются', async () => {
  const r = require(path.join(ROOT, 'tests', 'unit', 'law.js')).rng(11);
  for (let i = 0; i < 200; i++) {
    const size = r.int(0, 3000);
    const n = r.int(1, 5);
    const chunks = Array.from({ length: n }, () => Buffer.alloc(Math.ceil(size / n), 7));
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const type = r.pick(['image/png', 'image/x-icon; charset=x', 'text/html', 'application/json']);
    const lie = r.bool(0.3);
    let opts = null;
    const res = fakeResponse({ type, chunks, length: lie ? 10 : r.bool() ? total : undefined });
    const got = await readIcon(async (_u, o) => { opts = o; return res; }, 'https://a.com/favicon.ico', { max: 1000 });
    assert.equal(opts.credentials, 'omit');
    const ok = /^image\//.test(type) && total <= 1000;
    assert.equal(got !== null, ok, `${type} ${total}`);
    if (ok) assert.equal(Buffer.from(got.split(',')[1], 'base64').length, total);
    assert.ok(res.read() <= 1000 + Math.ceil(size / n), 'не читает дальше предела');
  }
  assert.equal(await readIcon(async () => fakeResponse({ chunks: [Buffer.from('x')], hang: true }), 'https://a.com/i.png', { timeout: 50 }), null);
  assert.equal(await readIcon(async () => fakeResponse({ status: 404 }), 'https://a.com/i.png'), null);
  assert.equal(await readIcon(async () => null, 'https://a.com/i.png'), null);
  assert.equal(await readIcon(async () => { throw new Error('сеть'); }, 'https://a.com/i.png'), null);
  assert.equal(await readIcon(async () => fakeResponse({ length: 5e6 }), 'https://a.com/i.png'), null);
  assert.equal(await readIcon(null, 'ftp://a.com/i.png'), null);
  assert.equal(await readIcon(null, 'data:image/png;base64,AA'), 'data:image/png;base64,AA');
  assert.equal(await readIcon(null, 'data:image/png;base64,' + 'A'.repeat(200000)), null);
});

test('закон: кэш значков не растёт больше предела и вытесняет самый давний', () => {
  const c = iconCache(3);
  for (const k of ['a', 'b', 'c']) c.set(k, k);
  assert.equal(c.get('a'), 'a');
  c.set('d', 'd');
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 'a');
  for (let i = 0; i < 1000; i++) c.set(`k${i}`, i);
  assert.equal(c.size(), 3);
  c.set('k999', 'x');
  assert.equal(c.get('k999'), 'x');
});

test('закон: одинаковые одновременные запросы разрешения - один вопрос; закрытый без ответа вопрос не запоминается; MIDI не даёт sysex', async () => {
  const r = require(path.join(ROOT, 'tests', 'unit', 'law.js')).rng(23);
  for (let round = 0; round < 50; round++) {
    const asked = [];
    let answer = null;
    const p = createPermissions({ ask: (site, perm) => { asked.push(`${site} ${perm}`); return new Promise((res) => setTimeout(() => res(answer), r.int(0, 3))); } });
    const first = r.pick([true, false, null]);
    answer = first;
    const n = r.int(2, 6);
    const results = await Promise.all(Array.from({ length: n }, () => p.request('https://a.com/', 'media')));
    assert.equal(asked.length, 1, 'один вопрос на одновременные запросы');
    assert.ok(results.every((x) => x === (first === true)));
    answer = true;
    const again = await p.request('https://a.com/', 'media');
    if (first === null) {
      assert.equal(asked.length, 2, 'закрытый без ответа вопрос задан снова');
      assert.equal(again, true);
    } else {
      assert.equal(asked.length, 1, 'ответ запомнен');
      assert.equal(again, first);
    }
  }
  const p = createPermissions({ ask: async () => true });
  assert.equal(await p.request('https://a.com/', 'midi'), true);
  assert.equal(p.check('https://a.com/', 'midiSysex'), false, 'разрешение MIDI не даёт sysex');
});

test('закон: на системе без различия регистра одновременные Report.pdf и report.pdf ложатся под разными именами', () => {
  const r = require(path.join(ROOT, 'tests', 'unit', 'law.js')).rng(31);
  for (let round = 0; round < 50; round++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-dl-'));
    const store = openStore();
    const m = createDownloads({ store, dir: () => dir, caseless: true });
    const paths = Array.from({ length: r.int(2, 8) }, () => { const it = fakeItem(r.pick(['Report.pdf', 'report.pdf', 'REPORT.PDF', 'other.zip']), 10); m.track(it); return it.savePath.toLowerCase(); });
    assert.equal(new Set(paths).size, paths.length);
    store.close();
  }
});

test('закон: «очистить список» убирает ровно те загрузки, что сейчас не идут (и на паузе остаётся)', () => {
  const r = require(path.join(ROOT, 'tests', 'unit', 'law.js')).rng(41);
  for (let round = 0; round < 60; round++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-dl-'));
    const store = openStore();
    store.addDownload({ url: 'https://x/', filename: 'old', path: path.join(dir, 'old'), state: 'progressing' });
    const m = createDownloads({ store, dir: () => dir });
    const live = [];
    for (let i = r.int(1, 8); i > 0; i--) {
      const it = fakeItem(`f${i}.bin`, 10);
      const id = m.track(it);
      const fate = r.pick(['done', 'pause', 'run', 'cancel']);
      if (fate === 'done') { fs.writeFileSync(it.savePath, 'x'); it.finish(); }
      else if (fate === 'cancel') it.cancel();
      else { if (fate === 'pause') m.act(id, 'pause'); live.push(id); }
    }
    m.clear();
    assert.deepEqual(store.listDownloads().map((d) => d.id).sort(), live.sort());
    store.close();
  }
});
