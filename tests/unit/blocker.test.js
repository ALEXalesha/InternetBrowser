// Законы блокировщика на случайном списке фильтров и случайных запросах.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { src, forAll } = require('./law');

const { createBlocker } = src('core/blocker');
const { buildEngine, needsUpdate, looksLikeList, WEEK, FALLBACK, SOURCES } = src('core/filters');
const { loadLists, updateLists, readMeta } = src('lib/lists');

const TYPES = ['subFrame', 'stylesheet', 'script', 'image', 'font', 'object', 'xhr', 'ping', 'media', 'webSocket', 'other'];
const POOL = Array.from({ length: 12 }, (_, i) => `ads${i}.com`);
const SITES = ['site1.com', 'site2.org', 'news.ru', 'ads0.com'];

function genWorld(r) {
  const blocked = POOL.filter(() => r.bool(0.4));
  const third = POOL.filter((d) => !blocked.includes(d) && r.bool(0.3));
  const except = blocked.filter(() => r.bool(0.3));
  const lines = ['[Adblock Plus 2.0]', ...blocked.map((d) => `||${d}^`), ...third.map((d) => `||${d}^$third-party`), ...except.map((d) => `@@||${d}/ok/`)];
  const off = SITES.filter(() => r.bool(0.3));
  const reqs = Array.from({ length: r.int(1, 60) }, () => {
    const top = r.pick(SITES);
    const host = r.bool(0.7) ? `${r.bool(0.3) ? 'cdn.' : ''}${r.pick(POOL)}` : r.pick(['site1.com', 'cdn.site2.org', 'news.ru', 'safe.net']);
    const scheme = r.pick(['https', 'https', 'http', 'wss', 'data', 'blob']);
    const url = scheme === 'data' ? 'data:image/png;base64,AA' : scheme === 'blob' ? `blob:https://${top}/x` : `${scheme}://${host}/${r.bool(0.3) ? 'ok/' : ''}x.js`;
    const type = r.bool(0.1) ? 'mainFrame' : r.pick(TYPES);
    if (type === 'mainFrame') return { url: `https://${top}/next`, host: top, scheme: 'https', type, tabId: r.int(1, 3), top, topUrl: '' };
    return { url, host, scheme, type, tabId: r.int(1, 3), top, topUrl: r.bool(0.05) ? 'ib://newtab/' : `https://${r.bool(0.2) ? 'www.' : ''}${top}/page` };
  });
  return { blocked, third, except, lines, off, reqs, enabled: r.bool(0.85) };
}

function domainOf(host) {
  return host.split('.').slice(-2).join('.');
}

// Страница вкладки - её последний документ (mainFrame), а если его не было - topUrl запроса.
function expected(w, q, lastMain) {
  if (q.type === 'mainFrame' || !w.enabled || !/^(https?|wss?)$/.test(q.scheme)) return false;
  const topUrl = lastMain.get(q.tabId) || q.topUrl;
  if (topUrl.startsWith('ib:')) return false;
  const top = new URL(topUrl).hostname.replace(/^www\./, '');
  if (w.off.includes(top)) return false;
  const d = domainOf(q.host);
  if (w.blocked.includes(d)) return !(w.except.includes(d) && q.url.includes('/ok/'));
  if (w.third.includes(d)) return d !== domainOf(top);
  return false;
}

test('закон: режется ровно то, что велит список, кроме выключенного сайта и документа вкладки; счётчик = числу блокировок', () => {
  forAll('blocker-model', genWorld, (w) => {
    const b = createBlocker({ engine: buildEngine([w.lines.join('\n')]), isSiteOn: (s) => !w.off.includes(s), enabled: () => w.enabled });
    const counts = new Map();
    const lastMain = new Map();
    let total = 0;
    for (const q of w.reqs) {
      const d = b.decide(q);
      const want = expected(w, q, lastMain);
      assert.equal(d.cancel, want, `${q.url} со страницы ${lastMain.get(q.tabId) || q.topUrl} (${q.type})`);
      if (q.type === 'mainFrame') { counts.set(q.tabId, 0); lastMain.set(q.tabId, q.url); }
      else if (d.cancel) counts.set(q.tabId, (counts.get(q.tabId) || 0) + 1);
      if (want) total++;
    }
    for (const id of [1, 2, 3]) assert.equal(b.stats(id).count, counts.get(id) || 0, `вкладка ${id}`);
    assert.equal(b.total(), total);
  }, 400);
});

test('закон: на выключенном сайте не режется ничего и скрывать на странице нечего', () => {
  forAll('blocker-site-off', genWorld, (w) => {
    const b = createBlocker({ engine: buildEngine([w.lines.concat(['##.ad', 'site1.com##.promo']).join('\n')]), isSiteOn: () => false });
    for (const q of w.reqs) assert.equal(b.decide(q).cancel, false);
    for (const id of [1, 2, 3]) assert.equal(b.stats(id).count, 0);
    assert.equal(b.cosmeticsFor('https://site1.com/', { classes: ['ad'] }), '');
  }, 200);
});

test('косметика: общие и сайтовые правила, выключатели', () => {
  const engine = buildEngine(['##.ad\nsite1.com##.promo\n##ins.adsbygoogle']);
  let cos = true;
  let on = true;
  const b = createBlocker({ engine, cosmetic: () => cos, isSiteOn: () => on });
  const css = b.cosmeticsFor('https://site1.com/', { classes: ['ad'] });
  assert.match(css, /\.promo/);
  assert.match(css, /\.ad\b/);
  assert.doesNotMatch(b.cosmeticsFor('https://other.com/'), /\.promo/);
  assert.equal(b.cosmeticsFor('ib://newtab/'), '');
  cos = false;
  assert.equal(b.cosmeticsFor('https://site1.com/'), '');
  cos = true; on = false;
  assert.equal(b.cosmeticsFor('https://site1.com/'), '');
  assert.equal(createBlocker().cosmeticsFor('https://a.com/'), '');
  const broken = createBlocker({ engine: { getCosmeticsFilters() { throw new Error('x'); }, match() { throw new Error('x'); } } });
  assert.equal(broken.cosmeticsFor('https://a.com/'), '');
  assert.equal(broken.decide({ url: 'https://a.com/x', type: 'script', tabId: 1, topUrl: 'https://b.com/' }).cancel, false);
});

test('счётчик: последние адреса, новая страница и закрытая вкладка', () => {
  const b = createBlocker({ engine: buildEngine(['||ads.com^']) });
  b.decide({ url: 'https://site.com/', type: 'mainFrame', tabId: 7 });
  for (let i = 0; i < 60; i++) b.decide({ url: `https://ads.com/${i}`, type: 'image', tabId: 7, topUrl: 'https://site.com/' });
  assert.equal(b.stats(7).count, 60);
  assert.equal(b.stats(7).recent.length, 50);
  assert.equal(b.stats(7).recent[0], 'https://ads.com/59');
  b.decide({ url: 'https://ads.com/x', type: 'image', topUrl: 'https://site.com/' });
  assert.equal(b.total(), 61);
  b.decide({ url: 'https://ads.com/', type: 'mainFrame' });
  b.forgetTab(7);
  assert.deepEqual(b.stats(7), { count: 0, recent: [] });
  b.setEngine(null);
  assert.equal(b.decide({ url: 'https://ads.com/y', type: 'image', tabId: 1, topUrl: 'https://site.com/' }).cancel, false);
});

test('закон: обновление списков раз в неделю, а при сбитых часах - сразу', () => {
  forAll('lists-weekly', (r) => ({ last: r.pick([NaN, 0, -5, undefined, r.int(1, 2e12)]), now: r.int(1, 2e12) }), ({ last, now }) => {
    const want = !(Number.isFinite(last) && last > 0) || last > now || now - last >= WEEK;
    assert.equal(needsUpdate(last, now), want);
  }, 1000);
  assert.equal(needsUpdate(1000, 1000 + WEEK - 1), false);
  assert.equal(needsUpdate(1000, 1000 + WEEK), true);
});

test('закон: страница ошибки, HTML и обрывки не считаются списком фильтров', () => {
  const rule = () => '||x.com^';
  forAll('lists-looks', (r) => {
    const kind = r.pick(['ok', 'html', 'short', 'nohead', 'junk']);
    const n = kind === 'short' ? r.int(0, 99) : r.int(100, 300);
    const body = Array.from({ length: n }, rule).join('\n');
    if (kind === 'ok') return { kind, text: `[Adblock Plus 2.0]\n! Title: EasyList\n${body}` };
    if (kind === 'html') return { kind, text: `<!DOCTYPE html><html>[Adblock Plus 2.0]\n${body}` };
    if (kind === 'short') return { kind, text: `[Adblock Plus 2.0]\n${body}` };
    if (kind === 'nohead') return { kind, text: body };
    return { kind, text: r.pick([null, 42, '', '!\n!\n']) };
  }, ({ kind, text }) => {
    assert.equal(looksLikeList(text), kind === 'ok');
  });
  assert.equal(looksLikeList(FALLBACK, 20), true);
});

function realList(n = 150) {
  return `[Adblock Plus 2.0]\n! Title: test\n${Array.from({ length: n }, (_, i) => `||ad${i}.com^`).join('\n')}\n`;
}

test('списки на диске: своя копия, копия сборки, запасной; обновление с запасным адресом', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-lists-'));
  const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-bundled-'));
  assert.deepEqual(loadLists({ dir, bundled }), { texts: [], from: 'fallback', updated: 0 });
  assert.deepEqual(loadLists({}), { texts: [], from: 'fallback', updated: 0 });
  fs.writeFileSync(path.join(bundled, 'easylist.txt'), realList());
  assert.equal(loadLists({ dir, bundled }).from, 'bundled');

  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('easylist.to/easylist/easylist.txt')) throw new Error('нет сети');
    if (url.includes('easylist.to')) return { ok: false, status: 503 };
    if (url.endsWith('easyprivacy.txt')) return { ok: true, text: async () => '<html>' };
    return { ok: true, text: async () => realList() };
  };
  const now = 5 * WEEK;
  let res = await updateLists({ dir, fetch, now });
  assert.equal(res.ok, false);
  assert.deepEqual(res.results.map((x) => x.ok), [true, false]);
  assert.equal(res.results[1].error, 'не список фильтров');
  assert.equal(readMeta(dir).updated, undefined);
  assert.equal(calls.length, 4);
  assert.equal(loadLists({ dir, bundled }).from, 'profile');

  const good = async () => ({ ok: true, text: async () => realList() });
  res = await updateLists({ dir, fetch: good, now });
  assert.equal(res.ok, true);
  assert.equal(readMeta(dir).updated, now);
  assert.equal((await updateLists({ dir, fetch: good, now: now + WEEK - 1 })).skipped, true);
  assert.equal((await updateLists({ dir, fetch: good, now: now + 1, force: true })).ok, true);
  assert.equal((await updateLists({ dir, fetch: async () => null, now: now + 3 * WEEK })).results[0].error, 'HTTP ?');
  fs.writeFileSync(path.join(dir, 'lists.json'), 'мусор');
  assert.deepEqual(readMeta(dir), {});
  fs.writeFileSync(path.join(dir, 'lists.json'), 'null');
  assert.deepEqual(readMeta(dir), {});
  assert.equal(SOURCES.every((s) => s.urls.length === 2), true);
  const e = buildEngine([]);
  const b = createBlocker({ engine: e });
  assert.equal(b.decide({ url: 'https://doubleclick.net/x', type: 'script', tabId: 1, topUrl: 'https://a.com/' }).cancel, true);
  const rejects = await updateLists({ dir, fetch: async () => { throw 'строка'; }, now: now + 9 * WEEK });
  assert.equal(rejects.results[0].error, 'строка');
});

test('закон: подресурс новой страницы судится по ней, даже если вкладка ещё показывает старый адрес', () => {
  forAll('blocker-stale-top', (r) => ({ off: r.bool(), steps: Array.from({ length: r.int(1, 20) }, () => ({ nav: r.bool(0.3), site: r.pick(['on.com', 'off.com']), commit: r.bool(0.5) })) }), ({ steps }) => {
    const b = createBlocker({ engine: buildEngine(['||ads.com^']), isSiteOn: (s) => s !== 'off.com' });
    let page = null;
    let committed = 'https://off.com/';
    for (const s of steps) {
      if (s.nav || !page) {
        page = `https://${s.site}/`;
        b.decide({ url: page, type: 'mainFrame', tabId: 1 });
        if (s.commit) { committed = page; b.committed(1, page); }
        continue;
      }
      const d = b.decide({ url: 'https://ads.com/x.js', type: 'script', tabId: 1, topUrl: committed });
      assert.equal(d.cancel, page === 'https://on.com/');
    }
  });
  const b = createBlocker({ engine: buildEngine(['||ads.com^']) });
  b.committed(5, 'https://a.com/');
  assert.equal(b.decide({ url: 'https://ads.com/x', type: 'image', tabId: 5, topUrl: 'ib://newtab/' }).cancel, true);
  b.committed(5, 'https://a.com/');
  assert.equal(b.stats(5).count, 1);
  b.committed(5, 'ib://newtab/');
  assert.equal(b.decide({ url: 'https://ads.com/x', type: 'image', tabId: 5, topUrl: 'https://a.com/' }).cancel, false);
});
