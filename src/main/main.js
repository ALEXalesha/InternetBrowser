// Главный процесс InternetBrowser: профиль, сеансы, блокировка, протокол ib://, окно.
//
// Сеансы:
//  - persist:browse - все вкладки (сайты и свои страницы ib://);
//  - по умолчанию   - только интерфейс окна (полоса вкладок и всплывающие окна);
//  - ib-lists       - отдельный, без куки и без диска: только скачивание списков фильтров.
//
// Тестовый режим (IB_TEST=1): окно не показывается, не берёт фокус и стоит за экраном;
// списки не скачиваются, если IB_LIST_URLS не указывает на свой сервер теста.
'use strict';

const path = require('path');
const fs = require('fs');
const { app, session, protocol, ipcMain, shell } = require('electron');

const { openStore } = require('../core/store');
const { createBlocker } = require('../core/blocker');
const { SOURCES, buildEngine } = require('../core/filters');
const { cleanUserAgent } = require('../core/ua');
const { resolveLang } = require('../core/settings');
const { findProfiles, importProfile } = require('../core/chrome');
const { siteOf } = require('../core/sites');
const { ENGINES } = require('../core/search');
const { THEMES } = require('../core/themes');
const i18n = require('../core/i18n');
const { loadLists, updateLists } = require('../lib/lists');
const protocolIb = require('../lib/protocol');
const { createDownloads } = require('../lib/downloads');
const { createPermissions } = require('../lib/permissions');
const { createBrowser } = require('./browser');

const TEST = process.env.IB_TEST === '1';
const ROOT = path.join(__dirname, '..', '..');

protocol.registerSchemesAsPrivileged([
  { scheme: 'ib', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } },
]);

app.setName('InternetBrowser');
// Никаких фоновых служб Chromium, которые ходили бы в сеть сами.
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,DialMediaRouteProvider,OptimizationHints,Translate,AutofillServerCommunication,CertificateTransparencyComponentUpdater');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('no-pings');
if (TEST) app.commandLine.appendSwitch('disable-gpu');
// Законы окна пускают весь трафик через свой прокси: он отдаёт тестовые сайты и записывает
// любую попытку уйти куда-то ещё («ничего не уходит наружу»).
if (TEST && process.env.IB_PROXY) app.commandLine.appendSwitch('proxy-server', process.env.IB_PROXY);

if (!TEST && !app.requestSingleInstanceLock()) app.quit();

let store;
let blocker;
let browser;
let downloads;
let listsState = { from: 'fallback', updated: 0, updating: false, error: '' };

function settings() {
  return store.getSettings();
}

function lang() {
  return resolveLang(settings().lang, app.getLocale());
}

function listSources() {
  if (process.env.IB_LIST_URLS) {
    const urls = process.env.IB_LIST_URLS.split(',');
    return SOURCES.map((s, i) => ({ ...s, urls: urls[i] ? [urls[i]] : [] }));
  }
  return SOURCES;
}

function rebuildEngine() {
  const dir = path.join(app.getPath('userData'), 'filters');
  const { texts, from, updated } = loadLists({ dir, bundled: path.join(process.resourcesPath || ROOT, 'filters'), minRules: TEST ? 1 : 100 });
  const local = fs.existsSync(path.join(ROOT, 'filters')) ? loadLists({ bundled: path.join(ROOT, 'filters') }) : null;
  const useLocal = from === 'fallback' && local && local.texts.length;
  blocker.setEngine(buildEngine(useLocal ? local.texts : texts));
  listsState = { ...listsState, from: useLocal ? 'bundled' : from, updated };
}

async function refreshLists(force) {
  if (TEST && !process.env.IB_LIST_URLS) return { skipped: true };
  if (!force && !settings().listsAutoUpdate) return { skipped: true };
  if (listsState.updating) return { skipped: true };
  listsState.updating = true;
  const allowed = new Set(listSources().flatMap((s) => s.urls));
  const ses = session.fromPartition('ib-lists');
  // В сеть из самого браузера - только адреса списков, ничего больше.
  const fetch = (url) => (allowed.has(url) ? ses.fetch(url, { credentials: 'omit', cache: 'no-store' }) : Promise.reject(new Error('адрес не из списка источников')));
  let res;
  try {
    res = await updateLists({ dir: path.join(app.getPath('userData'), 'filters'), fetch, force, sources: listSources(), minRules: TEST ? 1 : 100 });
    listsState.error = res.skipped || res.ok ? '' : res.results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error}`).join('; ');
    if (!res.skipped && res.results.some((r) => r.ok)) rebuildEngine();
  } catch (e) {
    listsState.error = String(e && e.message || e);
    res = { ok: false };
  } finally {
    listsState.updating = false;
  }
  browser && browser.pagesEvent({ type: 'lists' });
  return res;
}

function setupBrowseSession(ses) {
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  ses.setSpellCheckerEnabled(false);
  try { ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/'); } catch { /* нет на этой системе */ }
  protocolIb.install(ses);
}

function wireBrowseSession(ses) {
  ses.webRequest.onBeforeRequest((details, cb) => {
    const tab = browser ? browser.tabForWebContents(details.webContentsId) : null;
    let topUrl = '';
    if (tab) topUrl = details.resourceType === 'mainFrame' ? details.url : tab.view.webContents.getURL();
    const d = blocker.decide({ url: details.url, type: details.resourceType, tabId: tab ? tab.id : null, topUrl });
    if (d.cancel && tab) browser.blockedChanged(tab.id);
    cb({ cancel: d.cancel });
  });
  ses.on('will-download', (_e, item) => downloads.track(item));
  const perms = createPermissions({ ask: (site, perm) => browser.askPermission(site, perm) });
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    perms.request((details && details.requestingUrl) || wc.getURL(), perm).then(cb, () => cb(false));
  });
  ses.setPermissionCheckHandler((_wc, perm, origin) => perms.check(origin, perm));
}

function pageApi() {
  const S = () => store;
  return {
    init: () => ({
      lang: lang(), strings: i18n.table(lang()), settings: settings(), engines: ENGINES.map((e) => ({ id: e.id, name: lang() === 'en' && e.nameEn ? e.nameEn : e.name })),
      themes: THEMES.map((t) => t.id), version: app.getVersion(), chrome: process.versions.chrome, test: TEST,
    }),
    settingsSet: (patch) => {
      const next = S().setSettings(patch);
      browser.settingsChanged();
      if (patch && patch.listsAutoUpdate) refreshLists(false);
      return next;
    },
    newtab: () => ({ links: settings().links, blocked: blocker.total(), engine: settings().engine }),
    navigate: (text, _e, tab) => browser.navigateTab(tab.id, String(text || '')),
    historySearch: (q, offset) => S().searchHistory(String(q || ''), 100, Math.max(0, Number(offset) || 0)),
    historyDelete: (urls) => { S().deleteHistory(Array.isArray(urls) ? urls.map(String) : []); return true; },
    historyClear: () => { S().clearHistory(); return true; },
    bookmarksTree: () => S().tree(),
    bookmarksSearch: (q) => S().searchBookmarks(String(q || '')),
    bookmarkAdd: (b) => { const id = S().addBookmark(b); browser.bookmarksChanged(); return id; },
    folderAdd: (b) => { const id = S().addFolder(b); browser.bookmarksChanged(); return id; },
    bookmarkUpdate: (id, patch) => { const ok = S().updateBookmark(Number(id), patch || {}); browser.bookmarksChanged(); return ok; },
    bookmarkMove: (id, parent, pos) => { const ok = S().moveBookmark(Number(id), Number(parent), Number(pos)); browser.bookmarksChanged(); return ok; },
    bookmarkRemove: (id) => { const ok = S().removeBookmark(Number(id)); browser.bookmarksChanged(); return ok; },
    downloads: () => ({ list: downloads.list(), dir: downloadsDir() }),
    downloadAct: (id, action) => {
      const d = S().listDownloads().find((x) => x.id === Number(id));
      if (!d) return false;
      if (action === 'open') return shell.openPath(d.path).then((err) => !err);
      if (action === 'show') { shell.showItemInFolder(d.path); return true; }
      return downloads.act(Number(id), String(action));
    },
    downloadsClear: () => { S().clearDownloads(); browser.pagesEvent({ type: 'downloads' }); return true; },
    favicons: (sites) => Object.fromEntries((Array.isArray(sites) ? sites.slice(0, 300) : []).map((s) => [s, S().getFavicon(String(s))]).filter((e) => e[1])),
    lists: () => ({ ...listsState }),
    listsUpdate: () => refreshLists(true).then(() => ({ ...listsState })),
    sitesOff: () => S().blockingOffSites(),
    siteOn: (site) => { S().setBlocking(String(site), true); browser.blockedChanged(null); return true; },
    chromeProfiles: () => findProfiles().map((p) => ({ name: p.name, dir: p.dir, path: p.path, root: p.root, hasBookmarks: p.hasBookmarks, hasHistory: p.hasHistory })),
    chromeImport: (profilePath) => {
      const known = findProfiles().find((p) => p.path === profilePath);
      if (!known) return { error: 'profile' };
      try {
        const res = importProfile(S(), known.path, { folderTitle: i18n.t(lang(), 'importFolder'), names: { other: i18n.t(lang(), 'otherBookmarks'), synced: i18n.t(lang(), 'mobileBookmarks') } });
        browser.bookmarksChanged();
        return res;
      } catch (e) {
        return { error: String(e && e.code || e && e.message || e) };
      }
    },
  };
}

function downloadsDir() {
  return process.env.IB_DOWNLOADS || app.getPath('downloads');
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  store = openStore(path.join(userData, 'profile.sqlite'));
  blocker = createBlocker({
    engine: null,
    isSiteOn: (site) => store.isBlockingOn(site),
    enabled: () => settings().blocking,
    cosmetic: () => settings().cosmetic,
  });
  rebuildEngine();

  protocolIb.install(session.defaultSession);
  const browse = session.fromPartition('persist:browse');
  setupBrowseSession(browse);
  session.defaultSession.setSpellCheckerEnabled(false);

  downloads = createDownloads({ store, dir: downloadsDir, onChange: () => browser && browser.downloadsChanged() });
  browser = createBrowser({ store, blocker, browse, lang, settings, downloads, test: TEST, siteOf });
  wireBrowseSession(browse);

  const api = pageApi();
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(`page:${name}`, (e, ...args) => {
      const tab = browser.internalTabFor(e);
      if (!tab) throw new Error('нет доступа');
      return fn(...args, e, tab);
    });
  }

  const restore = settings().restoreTabs ? store.getSession() : [];
  const urls = process.argv.slice(1).filter((a) => /^(https?|ib|file):/i.test(a));
  browser.open(urls.length ? urls : restore);

  setTimeout(() => refreshLists(false), TEST ? 100 : 30000).unref();
  setInterval(() => refreshLists(false), 6 * 3600 * 1000).unref();

  if (TEST) {
    globalThis.ibTest = { store, blocker, browser, downloads, refreshLists, listsState: () => listsState, settings };
  }
});

app.on('second-instance', (_e, argv) => {
  if (!browser) return;
  const urls = argv.slice(1).filter((a) => /^(https?|file):/i.test(a));
  browser.focus(urls);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (browser && store) {
    try { store.setSession(browser.sessionUrls()); } catch { /* профиль уже закрыт */ }
  }
});

app.on('will-quit', () => {
  if (store) { try { store.close(); } catch { /* уже закрыт */ } store = null; }
});
