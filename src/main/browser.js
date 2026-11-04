// Окно браузера: полоса вкладок (интерфейс в самом окне), вкладки - WebContentsView под ней,
// всплывающий слой (подсказки, щит, меню, закладка, разрешения) - прозрачный WebContentsView
// поверх всего, только пока открыт. Всё, что приходит из страниц, проверяется: данные
// браузера доступны только своим страницам ib:// в главной рамке вкладки.
'use strict';

const path = require('path');
const fs = require('fs');
const { BrowserWindow, WebContentsView, ipcMain, Menu, clipboard, shell } = require('electron');

const { createTabs } = require('../core/tabs');
const { parseInput, forDisplay } = require('../core/omnibox');
const { NEWTAB, pageName } = require('../core/pages');
const { actionFor } = require('../core/keys');
const { isHistoryUrl } = require('../core/sites');
const { searchUrl } = require('../core/search');
const { isDark } = require('../core/themes');
const i18n = require('../core/i18n');
const { suggestions } = require('../lib/omnisource');
const { readIcon, iconCache } = require('../lib/favicon');

const ROOT = path.join(__dirname, '..', '..');
const UI_PRELOAD = path.join(__dirname, 'ui-preload.js');
const PAGE_PRELOAD = path.join(__dirname, 'page-preload.js');
const ICON = path.join(ROOT, 'build', 'icon.png');
const SUGGEST_ROW = 40;

const BASE = { glass: '#12101f', formal: '#1f242e', light: '#e8ecf3', night: '#08090e', warm: '#1d1610' };
const SYMBOL = { glass: '#f4f4f8', formal: '#e6e8ec', light: '#1b2030', night: '#dcdde3', warm: '#f5ead9' };

// Сбор классов и id на странице для общих правил скрытия (##.ad): в отдельном мире, страница его не видит.
const COLLECT = `(() => {
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  for (const el of document.querySelectorAll('[class],[id],a[href]')) {
    if (classes.size < 3000) for (const c of el.classList) classes.add(c);
    if (el.id && ids.size < 2000) ids.add(el.id);
    if (el.tagName === 'A' && hrefs.size < 1000) hrefs.add(el.href);
  }
  return { classes: [...classes], ids: [...ids], hrefs: [...hrefs] };
})()`;

function createBrowser({ store, blocker, browse, lang, settings, downloads, test, siteOf }) {
  const model = createTabs();
  const tabs = new Map();
  const byWc = new Map();
  let uiTop = 88;
  let fullscreen = false;
  let overlay = null;
  let overlayReady = null;
  let overlayKind = null;
  let overlayRect = null;
  let pushTimer = null;
  let pagesTimer = null;
  let barCache = null;
  let attached = null;
  const permQueue = [];
  let permCurrent = null;
  const faviconCache = iconCache(300);

  const t = (key, vars) => i18n.t(lang(), key, vars);
  const theme = () => settings().theme;
  const isWin = process.platform === 'win32';

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 320,
    show: false,
    focusable: !test,
    skipTaskbar: test,
    title: 'InternetBrowser',
    backgroundColor: BASE[theme()] || BASE.glass,
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    titleBarStyle: isWin ? 'hidden' : 'default',
    titleBarOverlay: isWin ? { color: BASE[theme()] || BASE.glass, symbolColor: SYMBOL[theme()] || SYMBOL.glass, height: 40 } : undefined,
    webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true, spellcheck: false, paintWhenInitiallyHidden: true, backgroundThrottling: false },
  });
  win.removeMenu();
  if (test) win.setPosition(-20000, -20000);
  else win.once('ready-to-show', () => win.show());
  win.webContents.loadURL('ib://ui/index.html');
  win.webContents.on('before-input-event', (e, input) => onKey(e, input, null));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('resize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', () => { fullscreen = false; layout(); push(); });
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') command('back');
    if (cmd === 'browser-forward') command('forward');
  });

  // ---------- вкладки ----------
  const activeTab = () => tabs.get(model.active()) || null;

  // adopt - опции окна, которое открыл сайт (window.open): вкладка берёт уже созданную Chromium
  // страницу, поэтому у неё есть window.opener (окна входа «через Google/GitHub» работают),
  // а адрес она загружает сама.
  function createView(id, url, adopt) {
    const view = new WebContentsView(adopt
      ? { webContents: adopt.webContents, webPreferences: { ...adopt.webPreferences, sandbox: true, contextIsolation: true, nodeIntegration: false } }
      : { webPreferences: { session: browse, preload: PAGE_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, safeDialogs: true } });
    view.setBackgroundColor(BASE[theme()] || '#ffffff');
    const tab = { id, view, state: { url, title: '', favicon: null, loading: true, audible: false, zoom: 0, crashed: false } };
    tabs.set(id, tab);
    byWc.set(view.webContents.id, tab);
    wire(tab);
    if (!adopt) view.webContents.loadURL(url).catch(() => {});
    return tab;
  }

  function openTab(url, opts = {}, adopt) {
    const id = model.open(url, opts);
    const tab = createView(id, url, adopt);
    if (opts.activate !== false) activate(id);
    else push();
    return tab;
  }

  function activate(id) {
    if (!model.activate(id)) return;
    const tab = tabs.get(id);
    if (attached && attached !== tab.view) win.contentView.removeChildView(attached);
    if (attached !== tab.view) win.contentView.addChildView(tab.view, 0);
    attached = tab.view;
    if (tab.state.crashed) { tab.state.crashed = false; tab.view.webContents.reload(); }
    layout();
    if (overlay && overlayKind) hideOverlay();
    push();
  }

  function destroyTab(tab) {
    if (attached === tab.view) { win.contentView.removeChildView(tab.view); attached = null; }
    byWc.delete(tab.view.webContents.id);
    tabs.delete(tab.id);
    blocker.forgetTab(tab.id);
    try { tab.view.webContents.close(); } catch { /* уже закрыта */ }
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const res = model.close(id);
    destroyTab(tab);
    if (res && res.opened) createView(res.opened, NEWTAB);
    activate(model.active());
  }

  function reopenTab() {
    const id = model.reopen();
    if (!id) return;
    createView(id, model.get(id).url);
    activate(id);
  }

  function navigateTab(id, text) {
    const tab = tabs.get(id);
    if (!tab) return false;
    const res = parseInput(text, settings().engine);
    if (res.kind === 'empty') return false;
    tab.view.webContents.loadURL(res.url).catch(() => {});
    tab.view.webContents.focus();
    return true;
  }

  function openPage(name) {
    const url = `ib://${name}/`;
    for (const m of model.list()) {
      if (pageName(tabs.get(m.id).state.url) === name) { activate(m.id); return; }
    }
    const cur = activeTab();
    // Адрес ставится сразу: вторая команда подряд (Настройки, затем История) не должна
    // занять ту же новую вкладку, пока первая ещё грузится.
    if (cur && pageName(cur.state.url) === 'newtab') { cur.state.url = url; model.update(cur.id, { url }); cur.view.webContents.loadURL(url).catch(() => {}); push(); }
    else openTab(url, { after: model.active() });
  }

  function addHistory(tab, url) {
    if (isHistoryUrl(url)) store.addVisit(url, tab.view.webContents.getTitle() === url ? '' : tab.view.webContents.getTitle());
  }

  function wire(tab) {
    const wc = tab.view.webContents;
    const st = tab.state;
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^https?:/i.test(url) && url !== 'about:blank') return { action: 'deny' };
      return {
        action: 'allow',
        createWindow: (options) => openTab(url, { after: tab.id, activate: disposition !== 'background-tab' }, options).view.webContents,
      };
    });
    wc.on('will-navigate', (e) => {
      // Сайт не может сам перейти на страницу браузера ib:// - только пользователь.
      if (/^ib:/i.test(e.url) && !/^ib:/i.test(wc.getURL())) e.preventDefault();
    });
    // Серверный редирект на ib:// не бывает законным никогда (даже если переход начал пользователь).
    wc.on('will-redirect', (e) => {
      if (/^ib:/i.test(e.url)) e.preventDefault();
    });
    wc.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame && /^ib:/i.test(e.url)) e.preventDefault();
    });
    wc.on('did-start-loading', () => { st.loading = true; push(); });
    wc.on('did-stop-loading', () => { st.loading = false; push(); });
    wc.on('did-navigate', (_e, url) => {
      blocker.committed(tab.id, url);
      st.url = url;
      st.favicon = siteOf(url) ? store.getFavicon(siteOf(url)) : null;
      st.title = '';
      model.update(tab.id, { url });
      addHistory(tab, url);
      push();
    });
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (!isMain) return;
      st.url = url;
      model.update(tab.id, { url });
      addHistory(tab, url);
      push();
    });
    wc.on('page-title-updated', (_e, title) => {
      st.title = title;
      model.update(tab.id, { title });
      if (isHistoryUrl(st.url)) store.setTitle(st.url, title);
      push();
    });
    wc.on('page-favicon-updated', (_e, icons) => fetchFavicon(tab, icons && icons[0]));
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain) blocker.aborted(tab.id);
      if (!isMain || code === -3 || /^ib:/i.test(url)) return;
      wc.loadURL(`ib://newtab/?error=${encodeURIComponent(desc)}&url=${encodeURIComponent(url)}`).catch(() => {});
    });
    wc.on('dom-ready', () => injectCosmetics(tab));
    wc.on('before-input-event', (e, input) => onKey(e, input, tab));
    wc.on('context-menu', (_e, params) => contextMenu(tab, params));
    wc.on('found-in-page', (_e, r) => sendUi('ui:found', { active: r.activeMatchOrdinal, total: r.matches }));
    wc.on('audio-state-changed', (e) => { st.audible = !!e.audible; push(); });
    wc.on('enter-html-full-screen', () => { fullscreen = true; win.setFullScreen(true); layout(); push(); });
    wc.on('leave-html-full-screen', () => { fullscreen = false; win.setFullScreen(false); layout(); push(); });
    wc.on('render-process-gone', () => { st.crashed = true; st.loading = false; push(); });
    wc.on('zoom-changed', (_e, dir) => zoom(tab, dir === 'in' ? 0.5 : -0.5));
  }

  async function injectCosmetics(tab) {
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!/^https?:/i.test(url)) return;
    try {
      const info = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: COLLECT }]);
      const css = blocker.cosmeticsFor(url, info || {});
      if (css && !wc.isDestroyed()) await wc.insertCSS(css, { cssOrigin: 'user' });
    } catch { /* страница ушла раньше */ }
  }

  async function fetchFavicon(tab, url) {
    const site = siteOf(tab.state.url);
    if (!site || !url || !/^(https?|data):/i.test(url)) return;
    const cached = faviconCache.get(url);
    if (cached !== undefined) { tab.state.favicon = cached; push(); return; }
    // Трекер под видом значка: адрес, который блокировщик срезал бы на этой странице, не запрашивается.
    if (blocker.judge(url, 'image', tab.state.url).cancel) return;
    const data = await readIcon((u, o) => browse.fetch(u, o), url);
    if (!data) return;
    faviconCache.set(url, data);
    if (siteOf(tab.state.url) === site) { tab.state.favicon = data; push(); }
    if (store.setFavicon(site, data)) barCache = null;
  }

  function zoom(tab, delta) {
    if (!tab) return;
    const wc = tab.view.webContents;
    const z = delta === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + delta));
    wc.setZoomLevel(z);
    tab.state.zoom = z;
    push();
  }

  function contextMenu(tab, p) {
    const wc = tab.view.webContents;
    const items = [];
    // Ссылку на файл с диска можно открыть только со страницы с диска, не с сайта.
    if (p.linkURL && (/^https?:/i.test(p.linkURL) || (/^file:/i.test(p.linkURL) && /^file:/i.test(wc.getURL())))) {
      items.push({ label: t('ctxOpenLinkTab'), click: () => openTab(p.linkURL, { after: tab.id, activate: false }) });
      items.push({ label: t('ctxCopyLink'), click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: t('ctxOpenImageTab'), click: () => openTab(p.srcURL, { after: tab.id, activate: false }) });
      items.push({ label: t('ctxSaveImage'), click: () => wc.downloadURL(p.srcURL) });
      items.push({ label: t('ctxCopyImageUrl'), click: () => clipboard.writeText(p.srcURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ label: t('ctxCut'), role: 'cut', enabled: p.editFlags.canCut });
      items.push({ label: t('ctxCopy'), role: 'copy', enabled: p.editFlags.canCopy });
      items.push({ label: t('ctxPaste'), role: 'paste', enabled: p.editFlags.canPaste });
      items.push({ label: t('ctxSelectAll'), role: 'selectAll' });
      items.push({ type: 'separator' });
    } else if (p.selectionText) {
      const q = p.selectionText.trim().slice(0, 80);
      items.push({ label: t('ctxCopy'), role: 'copy' });
      items.push({ label: t('ctxSearchFor', { q: q.length > 30 ? q.slice(0, 30) + '…' : q }), click: () => openTab(searchUrl(settings().engine, q), { after: tab.id }) });
      items.push({ type: 'separator' });
    }
    if (!items.length) {
      items.push({ label: t('ctxBack'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
      items.push({ label: t('ctxForward'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
      items.push({ label: t('ctxReload'), click: () => wc.reload() });
      if (isHistoryUrl(wc.getURL())) items.push({ label: t('ctxBookmarkPage'), click: () => command('bookmark') });
      items.push({ type: 'separator' });
    }
    items.push({ label: t('ctxInspect'), click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  }

  // ---------- раскладка ----------
  function layout() {
    if (win.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    const top = fullscreen ? 0 : uiTop;
    const tab = activeTab();
    if (tab) tab.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
    if (overlay && overlayKind) overlay.setBounds(overlayBounds(w, h));
  }

  function overlayBounds(w, h) {
    if (overlayKind === 'suggest' && overlayRect) {
      const n = overlayRect.rows || 1;
      const x = Math.max(0, Math.round(overlayRect.x));
      const width = Math.max(200, Math.min(w - x, Math.round(overlayRect.width)));
      return { x, y: Math.round(overlayRect.y + overlayRect.height + 4), width, height: Math.min(h, n * SUGGEST_ROW + 12) };
    }
    return { x: 0, y: 0, width: w, height: h };
  }

  // ---------- всплывающий слой ----------
  function ensureOverlay() {
    if (overlay) return overlayReady;
    overlay = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
    overlay.setBackgroundColor('#00000000');
    overlay.webContents.on('before-input-event', (e, input) => onKey(e, input, null));
    overlay.webContents.on('will-navigate', (e) => e.preventDefault());
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlayReady = overlay.webContents.loadURL('ib://ui/overlay.html').catch(() => {});
    return overlayReady;
  }

  async function showOverlay(kind, data, rect) {
    await ensureOverlay();
    // Другое окно поверх вопроса о разрешении: вопрос закрыт без ответа (не запоминается),
    // очередь продолжится, когда слой закроется.
    if (kind !== 'perm' && permCurrent) { permCurrent.resolve(null); permCurrent = null; }
    overlayKind = kind;
    overlayRect = rect || null;
    win.contentView.addChildView(overlay);
    layout();
    overlay.webContents.send('ov:show', { kind, data, rect: rect || null, settings: { theme: theme(), lang: lang() }, strings: i18n.table(lang()) });
    if (kind !== 'suggest') overlay.webContents.focus();
  }

  function hideOverlay() {
    if (!overlay || !overlayKind) return;
    const was = overlayKind;
    overlayKind = null;
    win.contentView.removeChildView(overlay);
    overlay.webContents.send('ov:hide');
    if (was === 'perm' && permCurrent) { permCurrent.resolve(null); permCurrent = null; }
    if (!permCurrent && permQueue.length) setImmediate(nextPerm);
    if (was === 'suggest') sendUi('ui:suggestClosed');
  }

  function askPermission(site, perm) {
    return new Promise((resolve) => {
      permQueue.push({ site, perm, resolve });
      if (!permCurrent) nextPerm();
    });
  }

  function nextPerm() {
    if (permCurrent || !permQueue.length) return;
    permCurrent = permQueue.shift();
    const key = `perm_${permCurrent.perm === 'midiSysex' ? 'midi' : permCurrent.perm}`;
    const what = i18n.t(lang(), key) === key ? t('perm_other') : t(key);
    showOverlay('perm', { site: permCurrent.site, what });
  }

  function shieldData() {
    const tab = activeTab();
    const site = tab ? siteOf(tab.state.url) : null;
    const st = tab ? blocker.stats(tab.id) : { count: 0, recent: [] };
    return { site, on: site ? store.isBlockingOn(site) : true, count: st.count, recent: st.recent.slice(0, 8), total: blocker.total(), enabled: settings().blocking };
  }

  function bookmarkData() {
    const tab = activeTab();
    if (!tab || !isHistoryUrl(tab.state.url)) return null;
    let b = store.bookmarksByUrl(tab.state.url)[0];
    let created = false;
    if (!b) {
      const id = store.addBookmark({ parent: store.ROOT_BAR, title: tab.state.title || tab.state.url, url: tab.state.url });
      b = store.bookmark(id);
      created = true;
      bookmarksChanged();
    }
    const folders = [];
    const walk = (node, depth) => {
      if (node.kind !== 'folder') return;
      folders.push({ id: node.id, depth, title: node.parent === null ? t(node.id === store.ROOT_BAR ? 'bookmarksBar' : 'otherBookmarks') : node.title });
      node.children.forEach((c) => walk(c, depth + 1));
    };
    store.tree().forEach((r) => walk(r, 0));
    return { id: b.id, title: b.title, parent: b.parent, folders, created };
  }

  function menuData() {
    const tab = activeTab();
    return { zoom: tab ? Math.round(Math.pow(1.2, tab.state.zoom) * 100) : 100, theme: theme(), canReopen: model.closedCount() > 0 };
  }

  function folderData(id) {
    return store.children(Number(id)).map((b) => ({ id: b.id, kind: b.kind, title: b.title, url: b.url, favicon: b.url ? store.getFavicon(siteOf(b.url)) : null }));
  }

  async function popup(kind, rect, arg) {
    if (overlayKind === kind && kind !== 'folder') { hideOverlay(); return; }
    let data;
    if (kind === 'shield') data = shieldData();
    else if (kind === 'menu') data = menuData();
    else if (kind === 'bookmark') { data = bookmarkData(); if (!data) return; }
    else if (kind === 'folder') data = { items: folderData(arg) };
    else if (kind === 'downloads') data = { list: downloads.list().slice(0, 5) };
    else return;
    await showOverlay(kind, data, rect);
  }

  // ---------- команды ----------
  function command(name, arg) {
    const tab = activeTab();
    const wc = tab && tab.view.webContents;
    const tabNum = /^tab:(\d)$/.exec(name);
    if (tabNum) { const id = model.byNumber(Number(tabNum[1])); if (id) activate(id); return true; }
    switch (name) {
      case 'newTab': openTab(NEWTAB, { after: model.active() }); sendUi('ui:focusAddress'); win.webContents.focus(); return true;
      case 'closeTab': if (tab) closeTab(tab.id); return true;
      case 'reopenTab': reopenTab(); return true;
      case 'nextTab': activate(model.cycle(1)); return true;
      case 'prevTab': activate(model.cycle(-1)); return true;
      case 'focusAddress': win.webContents.focus(); sendUi('ui:focusAddress'); return true;
      case 'reload': if (wc) wc.reload(); return true;
      case 'hardReload': if (wc) wc.reloadIgnoringCache(); return true;
      case 'stop': if (wc) wc.stop(); return true;
      case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true;
      case 'forward': if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true;
      case 'home': if (wc) wc.loadURL(NEWTAB); return true;
      case 'bookmark': sendUi('ui:popupRequest', 'bookmark'); return true;
      case 'history': openPage('history'); return true;
      case 'bookmarks': openPage('bookmarks'); return true;
      case 'downloads': openPage('downloads'); return true;
      case 'settings': case 'clearData': openPage('settings'); return true;
      case 'find': sendUi('ui:find'); win.webContents.focus(); return true;
      case 'zoomIn': zoom(tab, 0.5); return true;
      case 'zoomOut': zoom(tab, -0.5); return true;
      case 'zoomReset': zoom(tab, 0); return true;
      case 'devtools': if (wc) wc.toggleDevTools(); return true;
      case 'fullscreen': win.setFullScreen(!win.isFullScreen()); return true;
      case 'print': if (wc && !test) wc.print(); return true;
      case 'toggleBookmarksBar': store.setSettings({ bookmarksBar: !settings().bookmarksBar }); settingsChanged(); return true;
      case 'theme': store.setSettings({ theme: arg }); settingsChanged(); return true;
      case 'escape':
        if (overlayKind) { hideOverlay(); return true; }
        sendUi('ui:escape');
        return false;
      default: return false;
    }
  }

  function onKey(e, input, tab) {
    const action = actionFor(input, process.platform === 'darwin');
    if (!action || action === 'viewSource') return;
    if (action === 'escape') { if (command('escape')) e.preventDefault(); return; }
    if (action === 'find' && !tab && e.sender === win.webContents) { command('find'); e.preventDefault(); return; }
    if (command(action)) e.preventDefault();
  }

  // ---------- состояние для интерфейса ----------
  function titleOf(st) {
    const page = pageName(st.url);
    if (page) return t(page === 'newtab' ? 'newTab' : `${page}Title`);
    return st.title || forDisplay(st.url) || t('newTab');
  }

  // Страница ошибки - новая вкладка с ?error=..&url=..: в строке остаётся адрес, который не открылся.
  function failedUrl(url) {
    if (pageName(url) !== 'newtab') return '';
    try { return new URL(url).searchParams.get('url') || ''; } catch { return ''; }
  }

  function bar() {
    if (!settings().bookmarksBar) return null;
    if (!barCache) barCache = folderData(store.ROOT_BAR);
    return barCache;
  }

  function state() {
    const tab = activeTab();
    const st = tab ? tab.state : { url: '' };
    const wc = tab && tab.view.webContents;
    const site = siteOf(st.url);
    return {
      tabs: model.list().map((m) => {
        const x = tabs.get(m.id);
        return { id: m.id, title: titleOf(x.state), url: x.state.url, favicon: x.state.favicon, loading: x.state.loading, audible: x.state.audible, page: pageName(x.state.url), crashed: x.state.crashed };
      }),
      active: model.active(),
      nav: {
        url: st.url,
        display: failedUrl(st.url) || forDisplay(st.url),
        canBack: !!wc && wc.navigationHistory.canGoBack(),
        canForward: !!wc && wc.navigationHistory.canGoForward(),
        loading: !!st.loading,
        bookmarked: isHistoryUrl(st.url) && store.bookmarksByUrl(st.url).length > 0,
        canBookmark: isHistoryUrl(st.url),
        site,
        siteOn: site ? store.isBlockingOn(site) : true,
        blocked: tab ? blocker.stats(tab.id).count : 0,
        blocking: settings().blocking,
        zoom: st.zoom || 0,
        page: pageName(st.url),
        secure: /^(https|ib):/i.test(st.url || ''),
      },
      bar: bar(),
      downloads: downloads.active(),
      fullscreen,
      settings: { theme: theme(), lang: lang(), engine: settings().engine },
    };
  }

  function sendUi(ch, data) {
    if (!win.isDestroyed()) win.webContents.send(ch, data);
  }

  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (win.isDestroyed()) return;
      const s = state();
      sendUi('ui:state', s);
      const tab = activeTab();
      win.setTitle(tab ? `${titleOf(tab.state)} - InternetBrowser` : 'InternetBrowser');
    }, 16);
  }

  function pagesEvent(msg) {
    for (const tab of tabs.values()) {
      if (pageName(tab.state.url) && !tab.view.webContents.isDestroyed()) tab.view.webContents.send('page:event', msg);
    }
  }

  function settingsChanged() {
    barCache = null;
    const th = theme();
    win.setBackgroundColor(BASE[th]);
    if (isWin) { try { win.setTitleBarOverlay({ color: BASE[th], symbolColor: SYMBOL[th] }); } catch { /* старая система */ } }
    for (const tab of tabs.values()) tab.view.setBackgroundColor(BASE[th]);
    sendUi('ui:settings', { theme: th, lang: lang(), strings: i18n.table(lang()), dark: isDark(th) });
    pagesEvent({ type: 'settings' });
    push();
  }

  function bookmarksChanged() {
    barCache = null;
    pagesEvent({ type: 'bookmarks' });
    push();
  }

  function downloadsChanged() {
    if (pagesTimer) return;
    pagesTimer = setTimeout(() => { pagesTimer = null; pagesEvent({ type: 'downloads' }); push(); }, 200);
  }

  function blockedChanged() {
    push();
    if (overlayKind === 'shield' && overlay) overlay.webContents.send('ov:update', shieldData());
  }

  // ---------- IPC интерфейса ----------
  const fromUi = (e) => e.sender === win.webContents || (overlay && e.sender === overlay.webContents);
  const ui = {
    init: () => ({ strings: i18n.table(lang()), lang: lang(), settings: { theme: theme(), lang: lang(), dark: isDark(theme()) }, platform: process.platform, state: state() }),
    layout: (top) => { const v = Math.max(0, Math.min(400, Math.round(Number(top) || 0))); if (v !== uiTop) { uiTop = v; layout(); } return true; },
    navigate: (text) => { const tab = activeTab(); hideOverlay(); return tab ? navigateTab(tab.id, String(text || '')) : false; },
    omnibox: async (text, rect) => {
      const list = suggestions(store, String(text || ''), settings().engine);
      if (!list.length) { if (overlayKind === 'suggest') hideOverlay(); return list; }
      await showOverlay('suggest', { items: list, selected: 0, engine: settings().engine }, { ...(rect || {}), rows: list.length });
      return list;
    },
    omniboxSelect: (i) => { if (overlayKind === 'suggest') overlay.webContents.send('ov:select', Number(i) || 0); return true; },
    omniboxClose: () => { if (overlayKind === 'suggest') hideOverlay(); return true; },
    tab: (action, id, arg) => {
      id = Number(id);
      if (action === 'activate') activate(id);
      else if (action === 'close') closeTab(id);
      else if (action === 'new') command('newTab');
      else if (action === 'move') { model.move(id, Number(arg)); push(); }
      else if (action === 'reload' && tabs.get(id)) tabs.get(id).view.webContents.reload();
      return true;
    },
    command: (name, arg) => command(String(name), arg),
    popup: (kind, rect, arg) => popup(String(kind), rect, arg),
    // В Electron findNext: true - начать новый поиск; следующее совпадение того же текста - false.
    find: (text, opts) => { const tab = activeTab(); if (tab && text) tab.view.webContents.findInPage(String(text), { forward: !opts || opts.forward !== false, findNext: !(opts && opts.next) }); return true; },
    findStop: () => { const tab = activeTab(); if (tab) tab.view.webContents.stopFindInPage('clearSelection'); return true; },
    open: (url, how) => {
      const u = String(url || '');
      if (!/^(https?|file|ib):/i.test(u)) return false;
      hideOverlay();
      if (how === 'tab') openTab(u, { after: model.active(), activate: false });
      else { const tab = activeTab(); if (tab) tab.view.webContents.loadURL(u).catch(() => {}); }
      return true;
    },
    // всплывающий слой
    close: () => { hideOverlay(); return true; },
    shieldToggle: () => {
      const tab = activeTab();
      const site = tab && siteOf(tab.state.url);
      if (!site) return false;
      store.setBlocking(site, !store.isBlockingOn(site));
      overlay.webContents.send('ov:update', shieldData());
      tab.view.webContents.reload();
      push();
      return store.isBlockingOn(site);
    },
    bookmarkSave: (b) => { if (b && store.updateBookmark(Number(b.id), { title: String(b.title || '') })) { const cur = store.bookmark(Number(b.id)); if (b.parent && cur && Number(b.parent) !== cur.parent) store.moveBookmark(Number(b.id), Number(b.parent)); } bookmarksChanged(); hideOverlay(); return true; },
    bookmarkRemove: (id) => { store.removeBookmark(Number(id)); bookmarksChanged(); hideOverlay(); return true; },
    perm: (allow) => { const p = permCurrent; permCurrent = null; if (p) p.resolve(allow === true); hideOverlay(); nextPerm(); return true; },
    menu: (cmd, arg) => { hideOverlay(); return command(String(cmd), arg); },
  };
  for (const [name, fn] of Object.entries(ui)) {
    ipcMain.handle(`ui:${name}`, (e, ...args) => {
      if (!fromUi(e)) throw new Error('нет доступа');
      return fn(...args);
    });
  }

  function open(urls) {
    const list = (urls || []).filter((u) => typeof u === 'string');
    if (!list.length) list.push(NEWTAB);
    let first = null;
    for (const u of list) { const tab = openTab(u, { activate: !first }); if (!first) first = tab; }
  }

  return {
    win,
    open,
    focus(urls) { if (win.isMinimized()) win.restore(); if (!test) win.focus(); for (const u of urls || []) openTab(u); },
    tabForWebContents: (id) => byWc.get(id) || null,
    internalTabFor(e) {
      const tab = byWc.get(e.sender.id);
      if (!tab || !e.senderFrame || e.senderFrame !== e.sender.mainFrame) return null;
      return pageName(e.senderFrame.url) ? tab : null;
    },
    navigateTab, openTab, closeTab, activate, command, state, popup, hideOverlay,
    overlayKind: () => overlayKind,
    overlay: () => overlay,
    tabs: () => model.list().map((m) => ({ ...m, wcId: tabs.get(m.id).view.webContents.id, state: { ...tabs.get(m.id).state } })),
    activeWebContents: () => { const tab = activeTab(); return tab ? tab.view.webContents : null; },
    sessionUrls: () => model.list().map((m) => tabs.get(m.id).state.url).filter((u) => /^(https?|ib|file):/i.test(u)),
    askPermission, pagesEvent, settingsChanged, bookmarksChanged, downloadsChanged, blockedChanged,
    shell,
  };
}

module.exports = { createBrowser };
