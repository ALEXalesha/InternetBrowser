// Проверка проверок: каждое правило браузера по очереди ломается в копии проекта, и законы
// обязаны это заметить («мутант убит»). Исходники не меняются.
//
//   node tools/mutate.js              все мутанты (законы ядра - секунды, законы окна - до минуты)
//   node tools/mutate.js --check      только проверить, что каждая поломка на месте (для CI)
//   IB_MUT=blocker node tools/mutate.js   только те, чьё имя подходит под регулярку
//   IB_MUT_UNIT=1 node tools/mutate.js    только мутанты законов ядра (без окна)
//
// Сначала должны быть зелёными сами законы (npm test, npm run test:app): иначе упавший закон
// «убьёт» мутанта и без поломки.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// file - путь от корня, from -> to - поломка (from встречается в файле ровно один раз);
// edits - несколько поломок сразу; unit - имя закона node:test (регулярка);
// app - имя закона окна (-g для Playwright), spec - файл законов окна.
const MUTANTS = [
  // ---------- адресная строка ----------
  { id: 'omni-surrogate', file: 'src/core/omnibox.js', from: '.toWellFormed().trim()', to: '.trim()', unit: 'любой ввод даёт' },
  { id: 'omni-space-is-url', file: 'src/core/omnibox.js', from: "  if (/\\s/.test(text)) return search(text, engine);\n", to: '', unit: 'с пробелом внутри' },
  // защита от логина в адресе тройная (проверка @, буквы имени, URL.username) - ломается целиком
  { id: 'omni-userinfo', edits: [
    { file: 'src/core/omnibox.js', from: "if (!auth || auth.includes('@') || auth.includes('\\\\')) return null;", to: "if (!auth || auth.includes('\\\\')) return null;" },
    { file: 'src/core/omnibox.js', from: 'const LABEL = /^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}', to: 'const LABEL = /^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}@:-]{0,61}' },
    { file: 'src/core/omnibox.js', from: 'if (!u || u.username || u.password) return search(text, engine);', to: 'if (!u) return search(text, engine);' },
  ], unit: 'логин' },
  { id: 'omni-javascript', file: 'src/core/omnibox.js', from: 'if (scheme && BLOCKED.has(scheme)) return search(text, engine);', to: "if (scheme && BLOCKED.has(scheme)) return { kind: 'url', url: text };", unit: 'опасные схемы' },
  { id: 'omni-ip', file: 'src/core/omnibox.js', from: "  if (isIPv4(bare)) return { host: bare, port, scheme: 'http' };\n", to: '', unit: 'IPv4 и localhost' },
  { id: 'omni-local-https', file: 'src/core/omnibox.js', from: "new Set(['local', 'localhost',", to: "new Set(['localhost',", unit: 'известным окончанием' },
  { id: 'omni-any-tld', file: 'src/core/omnibox.js', from: 'if (!isKnownTld(tld) || /^\\d+$/.test(tld)) return null;', to: 'if (/^\\d+$/.test(tld)) return null;', unit: 'примеры адресной строки' },
  { id: 'search-encode', file: 'src/core/search.js', from: 'encodeURIComponent(query)', to: 'encodeURI(query)', unit: 'раскодируется обратно' },
  { id: 'omni-idempotent', file: 'src/core/pages.js', from: "return `ib://${name}/${tail}`;", to: "return `ib://${name}/${tail}`.replace(/\\/$/, '/x');", unit: 'идемпотентен' },
  { id: 'suggest-order', file: 'src/core/omnibox.js', from: '.sort((a, b) => b.score - a.score ||', to: '.sort((a, b) => a.score - b.score ||', unit: 'подсказки содержат' },
  { id: 'suggest-bookmark', file: 'src/core/omnibox.js', from: '(e.bookmarked ? 100 : 0)', to: '(e.bookmarked ? 0 : 0)', unit: 'закладка выше' },
  // ---------- хранилище ----------
  { id: 'history-visits', file: 'src/core/store.js', from: 'DO UPDATE SET visits = visits + 1,', to: 'DO UPDATE SET visits = 1,', unit: 'история туда-обратно' },
  { id: 'history-case', file: 'src/core/store.js', from: "return String(query || '').toLowerCase().split", to: "return String(query || '').split", unit: 'поиск по истории' },
  { id: 'history-delete', file: 'src/core/store.js', from: "const del = q('DELETE FROM history WHERE url = ?');", to: "const del = q('DELETE FROM history WHERE url <> ?');", unit: 'удаление из истории' },
  { id: 'bookmark-gap', file: 'src/core/store.js', from: "      q('DELETE FROM bookmarks WHERE id = ?').run(id);\n      shiftDown.run(b.parent, b.position);", to: "      q('DELETE FROM bookmarks WHERE id = ?').run(id);", unit: 'дерево закладок' },
  { id: 'bookmark-cycle', file: 'src/core/store.js', from: '!isFolder(parent) || isInside(id, parent)', to: '!isFolder(parent)', unit: 'дерево закладок' },
  { id: 'bookmark-import-dup', file: 'src/core/store.js', from: '          if (!dup) { insert(', to: '          if (true) { insert(', unit: 'импорт дерева закладок дважды' },
  { id: 'settings-junk', file: 'src/core/settings.js', from: "return typeof v === 'boolean' ? v : d;", to: 'return v === undefined ? d : v;', unit: 'настройки - любой мусор' },
  { id: 'sites-on', file: 'src/core/store.js', from: "    if (on) q('DELETE FROM sites WHERE site = ?').run(site);", to: "    if (on) q('DELETE FROM sites WHERE site = ?').run(site + ' ');", unit: 'выключатель блокировки по сайтам' },
  // ---------- блокировщик ----------
  { id: 'block-main-frame', file: 'src/core/blocker.js', from: "      if (tabId != null) tab(tabId).pending = { count: 0, recent: [], top: url };\n      return { cancel: false };", to: '      if (tabId != null) tab(tabId).pending = { count: 0, recent: [], top: url };', unit: 'режется ровно то' },
  { id: 'block-site-off', file: 'src/core/blocker.js', from: 'if (!site || !isSiteOn(site)) return { cancel: false };', to: 'if (!site) return { cancel: false };', unit: 'на выключенном сайте' },
  { id: 'block-count', file: 'src/core/blocker.js', from: '      page.count++;\n', to: '', unit: 'режется ровно то' },
  { id: 'block-stale-top', file: 'src/core/blocker.js', from: 'const res = judge(url, type, page && page.top ? page.top : topUrl);', to: 'const res = judge(url, type, topUrl);', unit: 'подресурс новой страницы' },
  { id: 'block-abort-ignored', file: 'src/core/blocker.js', from: '    if (t) t.pending = null;\n', to: '', unit: 'несостоявшийся переход' },
  { id: 'block-referrer-ignored', file: 'src/core/blocker.js', from: 'if (ref && t.top && ref === hostOf(t.top) && ref !== hostOf(t.pending.top)) return t;', to: '', unit: 'несостоявшийся переход' },
  { id: 'block-count-on-request', file: 'src/core/blocker.js', from: 'tabs.set(tabId, { count: t.pending.count, recent: t.pending.recent, top: url, pending: null });', to: 'tabs.set(tabId, { count: 0, recent: [], top: url, pending: null });', unit: 'несостоявшийся переход' },
  { id: 'block-scheme', file: 'src/core/blocker.js', from: 'const WEB = /^(https?|wss?):/i;', to: 'const WEB = /^https:/i;', unit: 'режется ровно то' },
  { id: 'lists-weekly', file: 'src/core/filters.js', from: 'return now - last >= WEEK;', to: 'return now - last > WEEK;', unit: 'раз в неделю' },
  { id: 'lists-html', file: 'src/core/filters.js', from: "  if (/<html|<!doctype/i.test(head)) return false;\n", to: '', unit: 'страница ошибки' },
  { id: 'lists-partial', file: 'src/lib/lists.js', from: '  if (ok) next.updated = now;', to: '  next.updated = now;', unit: 'списки на диске' },
  // ---------- импорт Chrome ----------
  { id: 'chrome-bigint', file: 'src/core/chrome.js', from: '      stmt.setReadBigInts(true);\n', to: '', unit: 'всё из поддельного профиля' },
  { id: 'chrome-hidden', file: 'src/core/chrome.js', from: 'FROM urls WHERE hidden = 0 ORDER', to: 'FROM urls ORDER', unit: 'всё из поддельного профиля' },
  { id: 'chrome-epoch', file: 'src/core/chrome.js', from: 'return Number(big / 1000n) - EPOCH_DIFF_MS;', to: 'return Number(big / 1000n) - EPOCH_DIFF_MS + 3600000;', unit: 'время Chrome' },
  { id: 'chrome-second-folder', file: 'src/core/chrome.js', from: "const existing = store.children(store.ROOT_BAR).find((b) => b.kind === 'folder' && b.title === folderTitle);", to: 'const existing = null;', unit: 'всё из поддельного профиля' },
  // ---------- загрузки, вкладки, клавиши, строка браузера ----------
  { id: 'download-reserved', file: 'src/core/downloads.js', from: "if (RESERVED.test(base.split('.')[0])) base = '_' + base;", to: '', unit: 'имя загрузки безопасно' },
  { id: 'download-overwrite', file: 'src/core/downloads.js', from: '  if (!taken(name)) return name;\n', to: '  return name;\n', unit: 'никогда не перезаписывает' },
  { id: 'download-same-name', file: 'src/lib/downloads.js', from: '(p) => reserved.has(norm(p)) || exists(p)', to: '(p) => exists(p)', unit: 'одновременные загрузки' },
  { id: 'download-case', file: 'src/lib/downloads.js', from: 'const norm = (p) => (caseless ? p.toLowerCase() : p);', to: 'const norm = (p) => p;', unit: 'без различия регистра' },
  { id: 'download-bidi', file: 'src/core/downloads.js', from: "  name = name.replace(/[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]/gu, '');\n", to: '', unit: 'имя загрузки безопасно' },
  { id: 'download-clear-paused', file: 'src/lib/downloads.js', from: 'store.clearDownloads([...live.keys()]);', to: 'store.clearDownloads([]);', unit: 'очистить список' },
  { id: 'download-clear-null', edits: [
    { file: 'src/core/store.js', from: "    if (!ids.length) { q('DELETE FROM downloads').run(); return; }\n", to: '' },
    { file: 'src/core/store.js', from: "${ids.map(() => '?').join(',')})`", to: "${ids.map(() => '?').join(',') || 'NULL'})`" },
  ], unit: 'загрузки и значки|очистить список' },
  { id: 'file-read', file: 'src/core/sites.js', from: "const FILE_OK = new Set(['mainFrame', 'subFrame', 'image', 'stylesheet', 'script', 'font', 'media']);", to: "const FILE_OK = new Set(['mainFrame', 'subFrame', 'image', 'stylesheet', 'script', 'font', 'media', 'xhr']);", unit: 'страница с диска не читает' },
  { id: 'display-ascii', file: 'src/core/omnibox.js', from: '      out += VISIBLE.test(ch) && encodeURIComponent(ch) === seq ? ch : seq;', to: '      out += ch;', unit: 'показанный в строке' },
  { id: 'favicon-no-cap', file: 'src/lib/favicon.js', from: '      if (size > max) { ctrl.abort(); return null; }\n', to: '', unit: 'значок читается' },
  { id: 'favicon-cookies', file: 'src/lib/favicon.js', from: "fetch(url, { credentials: 'omit', signal: ctrl.signal })", to: 'fetch(url, { signal: ctrl.signal })', unit: 'значок читается' },
  { id: 'favicon-no-timeout', file: 'src/lib/favicon.js', from: 'return await Promise.race([read(fetch, url, max, ctrl), late]);', to: 'return await read(fetch, url, max, ctrl);', unit: 'значок читается' },
  { id: 'favicon-cache-grows', file: 'src/lib/favicon.js', from: '      while (map.size > limit) map.delete(map.keys().next().value);\n', to: '', unit: 'кэш значков' },
  { id: 'permission-twice', file: 'src/lib/permissions.js', from: '    if (pending.has(k)) return pending.get(k);\n', to: '', unit: 'одинаковые одновременные запросы' },
  { id: 'permission-dismiss-remembered', file: 'src/lib/permissions.js', from: '      if (ans === true || ans === false) memory.set(k, ans);', to: '      memory.set(k, ans === true);', unit: 'одинаковые одновременные запросы' },
  { id: 'tabs-close-active', file: 'src/core/tabs.js', from: 'active = list[Math.min(i, list.length - 1)].id;', to: 'active = list[0].id;', unit: 'полосы вкладок всегда' },
  { id: 'tabs-reopen-place', file: 'src/core/tabs.js', from: 'list.splice(Math.min(c.index, list.length), 0,', to: 'list.splice(list.length, 0,', unit: 'полосы вкладок всегда' },
  { id: 'keys-by-letter', file: 'src/core/keys.js', from: "const code = input.code || '';", to: "const code = input.key ? 'Key' + String(input.key).toUpperCase() : input.code || '';", unit: 'раскладке' },
  { id: 'ua-electron', file: 'src/core/ua.js', from: '(Electron|internet-browser|InternetBrowser)', to: '(internet-browser|InternetBrowser)', unit: 'строка браузера без Electron' },
  { id: 'protocol-escape', file: 'src/lib/protocol.js', from: "  if (path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) return null;\n", to: '', unit: 'никогда не выводит' },
  { id: 'permission-every-time', file: 'src/lib/permissions.js', from: '    if (memory.has(k)) return memory.get(k);\n', to: '', unit: 'спрашивается один раз' },
  { id: 'i18n-missing', file: 'src/core/i18n.js', from: "      findNone: 'No matches',\n", to: '', unit: 'у каждой строки есть перевод' },
  // ---------- окно ----------
  { id: 'app-no-blocking', file: 'src/main/main.js', from: '    cb({ cancel: d.cancel });', to: '    cb({ cancel: false });', app: 'блокировка:', spec: 'browser.spec.js' },
  { id: 'app-no-cosmetics', file: 'src/main/browser.js', from: 'if (css && !wc.isDestroyed()) await wc.insertCSS', to: 'if (false) await wc.insertCSS', app: 'блокировка:', spec: 'browser.spec.js' },
  { id: 'app-toggle-no-reload', file: 'src/main/browser.js', from: "      overlay.webContents.send('ov:update', shieldData());\n      tab.view.webContents.reload();", to: "      overlay.webContents.send('ov:update', shieldData());", app: 'блокировка:', spec: 'browser.spec.js' },
  { id: 'app-site-opens-ib', file: 'src/main/browser.js', from: "if (/^ib:/i.test(e.url) && !/^ib:/i.test(wc.getURL())) e.preventDefault();", to: '', app: 'вкладки:', spec: 'browser.spec.js' },
  { id: 'app-remote-icons', edits: [
    { file: 'src/pages/newtab.js', from: "ic ? `<img src=\"${P.esc(ic)}\" alt=\"\">` :", to: "`<img src=\"https://icons.duckduckgo.com/ip3/${P.host(l.url)}.ico\" alt=\"\">` || " },
    { file: 'src/lib/protocol.js', from: "img-src ib: data:;", to: "img-src ib: data: https:;" },
  ], app: 'наружу не уходит ничего', spec: 'browser.spec.js' },
  { id: 'app-download-dir', file: 'src/lib/downloads.js', from: 'targetPath(dir(), item.getFilename()', to: "targetPath(require('os').tmpdir(), item.getFilename()", app: 'загрузки:', spec: 'browser.spec.js' },
  { id: 'app-find-next', file: 'src/main/browser.js', from: 'findNext: !(opts && opts.next)', to: 'findNext: !!(opts && opts.next)', app: 'поиск на странице', spec: 'browser.spec.js' },
  { id: 'app-history-title', file: 'src/main/browser.js', from: '      if (isHistoryUrl(st.url)) store.setTitle(st.url, title);\n', to: '', app: 'адресная строка:', spec: 'browser.spec.js' },
  { id: 'app-import-wrong-profile', file: 'src/main/main.js', from: 'const known = findProfiles().find((p) => p.path === profilePath);', to: 'const known = findProfiles().find((p) => p.path !== profilePath);', app: 'импорт из Chrome', spec: 'browser.spec.js' },
  { id: 'app-dim-formal', file: 'src/ui/themes.css', from: '--text-dim: rgba(230, 232, 236, 0.64);', to: '--text-dim: rgba(230, 232, 236, 0.55);', app: 'все темы.*ru-RU', spec: 'look.spec.js' },
  { id: 'app-fill-warm', file: 'src/ui/themes.css', from: '--fill-grad: linear-gradient(135deg, #9e682d 0%, #b4562f 100%);', to: '--fill-grad: var(--accent-grad);', app: 'все темы.*ru-RU', spec: 'look.spec.js' },
  { id: 'app-narrow-field', file: 'src/ui/ui.css', from: '  min-width: 80px;\n  height: 36px;', to: '  min-width: 300px;\n  height: 36px;', app: 'все темы.*ru-RU', spec: 'look.spec.js' },
  { id: 'app-layout-top', file: 'src/main/browser.js', from: 'if (tab) tab.view.setBounds({ x: 0, y: top,', to: 'if (tab) tab.view.setBounds({ x: 0, y: 0,', app: 'узкое окно', spec: 'look.spec.js' },
  { id: 'app-redirect-ib', file: 'src/main/browser.js', from: "      if (/^ib:/i.test(e.url)) e.preventDefault();\n    });\n    wc.on('will-frame-navigate'", to: "    });\n    wc.on('will-frame-navigate'", app: 'ни редиректом', spec: 'browser.spec.js' },
  { id: 'app-file-read', file: 'src/main/main.js', from: '    if (blocksFileRead(details.url, details.resourceType)) { cb({ cancel: true }); return; }\n', to: '', app: 'ни редиректом', spec: 'browser.spec.js' },
  { id: 'app-favicon-tracker', file: 'src/main/browser.js', from: "    if (blocker.judge(url, 'image', tab.state.url).cancel) return;\n", to: '', app: 'блокировка:', spec: 'browser.spec.js' },
  { id: 'app-bookmark-moves', file: 'src/main/browser.js', from: 'if (b.parent && cur && Number(b.parent) !== cur.parent)', to: 'if (b.parent && cur)', app: 'переименование закладки', spec: 'browser.spec.js' },
  { id: 'app-window-open-null', file: 'src/main/browser.js', from: "        action: 'allow',\n", to: "        action: 'deny',\n", app: 'window.open', spec: 'browser.spec.js' },
  { id: 'app-tab-leak', file: 'src/main/browser.js', from: '    try { tab.view.webContents.close(); } catch { /* уже закрыта */ }\n', to: '', app: '20 открытых и закрытых', spec: 'memory.spec.js' },
  { id: 'app-open-page-race', file: 'src/main/browser.js', from: '{ cur.state.url = url; model.update(cur.id, { url }); cur.view', to: '{ cur.view', app: 'все темы.*ru-RU', spec: 'look.spec.js' },
];

function edits(m) {
  return m.edits || [{ file: m.file, from: m.from, to: m.to }];
}

function count(file, from) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split(from).length - 1;
}

if (process.argv.includes('--check')) {
  let bad = 0;
  const ids = new Set();
  for (const m of MUTANTS) {
    if (ids.has(m.id)) { bad++; console.log(`${m.id}: имя повторяется`); }
    ids.add(m.id);
    for (const e of edits(m)) {
      const n = count(e.file, e.from);
      if (n !== 1) { bad++; console.log(`${m.id}: в ${e.file} найдено ${n}`); }
    }
  }
  console.log(`мутантов ${MUTANTS.length}, не на месте ${bad}`);
  process.exit(bad ? 1 : 0);
}

function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-mut-'));
  for (const f of ['src', 'tests', 'package.json', 'playwright.app.config.js']) fs.cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function run(m, dir) {
  const env = { ...process.env, IB_ROOT: dir };
  let r;
  if (m.unit) {
    const files = fs.readdirSync(path.join(dir, 'tests', 'unit')).filter((f) => f.endsWith('.test.js')).map((f) => `tests/unit/${f}`);
    // отчёт TAP явно: в Node 24 без терминала по умолчанию другой формат (без «# pass N»);
    // срок 2 минуты - мутант, от которого закон зависает, тоже убит
    r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-name-pattern', m.unit, ...files], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
    // закон завис и снят по сроку - поломка поймана
    if (r.status === null || r.signal || (r.error && r.error.code === 'ETIMEDOUT')) return { status: 1, note: 'закон завис' };
    // законы, подходящие под имя, должны найтись: иначе мутант «выжил» бы незамеченным
    const pass = Number((/# pass (\d+)/.exec(r.stdout || '') || [])[1] || 0);
    const fail = Number((/# fail (\d+)/.exec(r.stdout || '') || [])[1] || 0);
    if (pass + fail === 0) return { status: 0, note: 'законы не найдены' };
  } else {
    const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
    const args = [cli, 'test', '--config=playwright.app.config.js', `tests/app/${m.spec}`, '-g', m.app, '--workers=1', '--reporter=line', '--retries=0', '--max-failures=1'];
    r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 900000 });
    if (/No tests found/.test((r.stdout || '') + (r.stderr || ''))) return { status: 0, note: 'законы не найдены' };
  }
  return { status: r.status };
}

const filter = process.env.IB_MUT ? new RegExp(process.env.IB_MUT) : null;
const list = MUTANTS.filter((m) => (!filter || filter.test(m.id)) && (!process.env.IB_MUT_UNIT || m.unit));
let survived = 0;
const t0 = Date.now();
for (const m of list) {
  const dir = copyProject();
  const started = Date.now();
  let line;
  try {
    let ok = true;
    for (const e of edits(m)) {
      const file = path.join(dir, e.file);
      const text = fs.readFileSync(file, 'utf8');
      if (text.split(e.from).length - 1 !== 1) { ok = false; break; }
      fs.writeFileSync(file, text.replace(e.from, e.to));
    }
    if (!ok) { survived++; line = `${m.id}: НЕ НА МЕСТЕ`; }
    else {
      const res = run(m, dir);
      const killed = res.status !== 0;
      if (!killed) survived++;
      line = `${m.id}: ${killed ? 'убит' : 'ВЫЖИЛ'}${res.note ? ` (${res.note})` : ''} (${m.unit ? 'ядро' : 'окно'}, ${Math.round((Date.now() - started) / 1000)} с)`;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(line);
}
console.log(`\nмутантов ${list.length}, убито ${list.length - survived}, выжило ${survived} (${Math.round((Date.now() - t0) / 1000)} с)`);
process.exit(survived ? 1 : 0);
