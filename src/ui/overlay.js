// Всплывающий слой: рисует панель по команде главного процесса (ov:show) и отправляет
// выбор обратно. Нажатие мимо панели закрывает слой.
'use strict';
(() => {
  const { icon } = window.IBIcons;
  const root = document.getElementById('root');
  const call = (...a) => window.ibui.call(...a);
  let S = {};
  let cur = null;

  const t = (k, v) => {
    const s = S[k];
    if (s === undefined) return k;
    return v ? s.replace(/\{(\w+)\}/g, (m, x) => (v[x] === undefined ? m : v[x])) : s;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  function place(panel, rect, align) {
    const vw = innerWidth;
    const vh = innerHeight;
    const r = rect || { x: vw / 2, y: 60, width: 0, height: 0 };
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let left = align === 'left' || r.x + r.width / 2 < vw / 2 ? r.x : r.x + r.width - w;
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top = r.y + r.height + 6;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function shell(html, cls) {
    root.innerHTML = `<div class="backdrop"></div><div class="panel ${cls || ''}" role="dialog">${html}</div>`;
    root.querySelector('.backdrop').addEventListener('mousedown', () => call('close'));
    return root.querySelector('.panel');
  }

  // ---------- подсказки ----------
  function suggestRow(it, i) {
    const ic = it.type === 'search' ? icon('search') : it.type === 'bookmark' ? icon('star') : it.type === 'open' ? icon('globe') : icon('history');
    let main;
    if (it.type === 'search') main = `<span class="grow ellipsis">${esc(t('suggestSearch', { q: it.title, engine: cur.data.engineName || '' }))}</span>`;
    else if (it.type === 'open') main = `<span class="grow ellipsis url">${esc(it.url)}</span>`;
    else main = `<span class="grow ellipsis">${esc(it.title || host(it.url))} <span class="dim small">- ${esc(it.url)}</span></span>`;
    return `<button class="row item${i === cur.data.selected ? ' sel' : ''}" data-i="${i}">${ic}${main}</button>`;
  }
  function renderSuggest() {
    root.innerHTML = `<div class="panel suggest">${cur.data.items.map(suggestRow).join('')}</div>`;
    for (const b of root.querySelectorAll('[data-i]')) {
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const it = cur.data.items[Number(b.dataset.i)];
        call('open', it.url, e.button === 1 || e.ctrlKey ? 'tab' : 'here');
      });
    }
  }

  // ---------- щит ----------
  function renderShield() {
    const d = cur.data;
    let body;
    if (!d.enabled) body = `<div class="row dim">${esc(t('shieldGlobalOff'))}</div>`;
    else if (!d.site) body = `<div class="row dim">${esc(t('shieldNoSite'))}</div>`;
    else {
      body = `<div class="shield-count"><b id="count">${d.on ? d.count : 0}</b><span class="dim">${esc(t('shieldBlocked'))}</span></div>
        <label class="row"><span class="grow ellipsis">${esc(t('shieldOnSite', { site: d.site }))}</span><input type="checkbox" class="switch" id="site-on" ${d.on ? 'checked' : ''}></label>
        ${d.on ? '' : `<div class="row dim small">${esc(t('shieldOffNote'))}</div>`}
        ${d.on && d.recent.length ? `<div class="sep"></div><div class="row dim small">${esc(t('shieldRecent'))}</div><div class="recent">${d.recent.map((u) => `<div title="${esc(u)}">${esc(u)}</div>`).join('')}</div>` : ''}`;
    }
    const p = shell(`<h3>${esc(t('shield'))}</h3>${body}<div class="sep"></div><div class="row dim small">${esc(t('shieldTotal', { n: d.total }))}</div>`);
    p.style.width = '320px';
    place(p, cur.rect);
    const sw = p.querySelector('#site-on');
    if (sw) sw.addEventListener('change', () => call('shieldToggle'));
  }

  // ---------- меню ----------
  function renderMenu() {
    const d = cur.data;
    const item = (cmd, ic, label, kbd, disabled) => `<button class="row item" data-cmd="${cmd}" ${disabled ? 'disabled style="opacity:.4"' : ''}>${icon(ic)}<span class="grow">${esc(t(label))}</span>${kbd ? `<span class="kbd">${kbd}</span>` : ''}</button>`;
    const names = t('themeNames').split('|');
    const ids = ['glass', 'formal', 'light', 'night', 'warm'];
    const p = shell(`
      ${item('newTab', 'newtab', 'menuNewTab', 'Ctrl+T')}
      ${item('reopenTab', 'reopen', 'menuReopen', 'Ctrl+Shift+T', !d.canReopen)}
      <div class="sep"></div>
      ${item('history', 'history', 'menuHistory', 'Ctrl+H')}
      ${item('bookmarks', 'bookmarks', 'menuBookmarks', '')}
      ${item('downloads', 'download', 'menuDownloads', 'Ctrl+J')}
      <div class="sep"></div>
      <div class="row"><span class="grow">${esc(t('menuZoom'))}</span><span class="zoomrow"><button class="mini" data-cmd="zoomOut" title="Ctrl+-">${icon('minus')}</button><button class="mini" data-cmd="zoomReset" style="width:56px">${d.zoom} %</button><button class="mini" data-cmd="zoomIn" title="Ctrl+=">${icon('plus')}</button></span></div>
      ${item('find', 'find', 'menuFind', 'Ctrl+F')}
      <div class="row dim small">${esc(t('menuTheme'))}</div>
      <div class="themes">${ids.map((id, i) => `<button class="swatch sw-${id}${d.theme === id ? ' on' : ''}" data-theme-id="${id}" title="${esc(names[i])}" aria-label="${esc(names[i])}"></button>`).join('')}</div>
      <div class="sep"></div>
      ${item('settings', 'gear', 'menuSettings', '')}
      ${item('devtools', 'code', 'menuDevtools', 'F12')}`);
    p.style.width = '300px';
    place(p, cur.rect);
    for (const b of p.querySelectorAll('[data-cmd]')) {
      b.addEventListener('click', () => {
        const keep = /^zoom/.test(b.dataset.cmd);
        if (keep) call('command', b.dataset.cmd).then(() => { cur.data.zoom = zoomAfter(b.dataset.cmd, cur.data.zoom); renderMenu(); });
        else call('menu', b.dataset.cmd);
      });
    }
    for (const b of p.querySelectorAll('[data-theme-id]')) b.addEventListener('click', () => call('command', 'theme', b.dataset.themeId));
  }
  function zoomAfter(cmd, z) {
    const level = Math.round(Math.log(z / 100) / Math.log(1.2) * 2) / 2;
    const next = cmd === 'zoomReset' ? 0 : Math.max(-5, Math.min(5, level + (cmd === 'zoomIn' ? 0.5 : -0.5)));
    return Math.round(Math.pow(1.2, next) * 100);
  }

  // ---------- закладка ----------
  function renderBookmark() {
    const d = cur.data;
    const p = shell(`<h3>${esc(t(d.created ? 'bookmarkAdded' : 'bookmarkEdit'))}</h3>
      <label class="f"><span>${esc(t('bookmarkName'))}</span><input class="t" id="bm-title" value="${esc(d.title)}"></label>
      <label class="f"><span>${esc(t('bookmarkFolder'))}</span><select class="t" id="bm-folder">${d.folders.map((f) => `<option value="${f.id}" ${f.id === d.parent ? 'selected' : ''}>${'  '.repeat(f.depth)}${esc(f.title)}</option>`).join('')}</select></label>
      <div class="buttons"><button class="btn danger" id="bm-remove">${esc(t('bookmarkRemove'))}</button><button class="btn primary" id="bm-done">${esc(t('done'))}</button></div>`);
    p.style.width = '320px';
    place(p, cur.rect);
    const title = p.querySelector('#bm-title');
    title.focus();
    title.select();
    const save = () => call('bookmarkSave', { id: d.id, title: title.value, parent: Number(p.querySelector('#bm-folder').value) });
    p.querySelector('#bm-done').addEventListener('click', save);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    p.querySelector('#bm-remove').addEventListener('click', () => call('bookmarkRemove', d.id));
  }

  // ---------- папка панели закладок ----------
  function renderFolder() {
    const items = cur.data.items;
    const p = shell(items.length ? items.map((b, i) => `<button class="row item" data-i="${i}">${b.kind === 'folder' ? icon('folder') : b.favicon ? `<img src="${esc(b.favicon)}" alt="" width="16" height="16">` : icon('globe')}<span class="grow ellipsis">${esc(b.title || b.url)}</span></button>`).join('') : `<div class="row dim">${esc(t('emptyFolder'))}</div>`);
    p.style.maxWidth = '360px';
    place(p, cur.rect, 'left');
    for (const el of p.querySelectorAll('[data-i]')) {
      el.addEventListener('click', (e) => {
        const b = items[Number(el.dataset.i)];
        if (b.kind === 'folder') {
          const r = el.getBoundingClientRect();
          call('popup', 'folder', { x: r.right - 8, y: r.top - 6, width: 0, height: 0 }, b.id);
        } else call('open', b.url, e.ctrlKey ? 'tab' : 'here');
      });
    }
  }

  // ---------- загрузки ----------
  function renderDownloads() {
    const list = cur.data.list;
    const rows = list.map((d) => {
      const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
      return `<div class="row"><span class="grow"><div class="ellipsis">${esc(d.filename)}</div><div class="dim small">${esc(t(`dl_${d.state}`))}${d.state === 'progressing' && d.total ? ` · ${pct} %` : ''}</div>${d.state === 'progressing' ? `<div class="bar-progress"><i style="width:${pct}%"></i></div>` : ''}</span></div>`;
    }).join('');
    const p = shell(`<h3>${esc(t('downloadsTitle'))}</h3>${rows || `<div class="row dim">${esc(t('downloadsEmpty'))}</div>`}<div class="sep"></div><button class="row item" data-cmd="downloads">${icon('external')}<span class="grow">${esc(t('menuDownloads'))}</span><span class="kbd">Ctrl+J</span></button>`);
    p.style.width = '320px';
    place(p, cur.rect);
    p.querySelector('[data-cmd]').addEventListener('click', () => call('menu', 'downloads'));
  }

  // ---------- разрешение ----------
  function renderPerm() {
    const d = cur.data;
    const p = shell(`<div class="row"><span class="grow">${esc(t('permAsk', { site: d.site, what: d.what }))}</span></div><div class="buttons"><button class="btn" id="deny">${esc(t('permDeny'))}</button><button class="btn primary" id="allow">${esc(t('permAllow'))}</button></div>`);
    p.style.width = '380px';
    place(p, { x: 90, y: 40, width: 0, height: 0 }, 'left');
    p.querySelector('#allow').addEventListener('click', () => call('perm', true));
    p.querySelector('#deny').addEventListener('click', () => call('perm', false));
  }

  const RENDER = { suggest: renderSuggest, shield: renderShield, menu: renderMenu, bookmark: renderBookmark, folder: renderFolder, downloads: renderDownloads, perm: renderPerm };

  window.ibui.on('ov:show', (msg) => {
    S = msg.strings || S;
    document.documentElement.dataset.theme = msg.settings.theme;
    document.documentElement.lang = msg.settings.lang;
    cur = msg;
    if (msg.kind === 'suggest') msg.data.engineName = engineName(msg.data.engine);
    (RENDER[msg.kind] || (() => {}))();
  });
  window.ibui.on('ov:hide', () => { root.innerHTML = ''; cur = null; });
  window.ibui.on('ov:select', (i) => {
    if (!cur || cur.kind !== 'suggest') return;
    cur.data.selected = i;
    for (const b of root.querySelectorAll('[data-i]')) b.classList.toggle('sel', Number(b.dataset.i) === i);
  });
  window.ibui.on('ov:update', (data) => { if (cur && cur.kind === 'shield') { cur.data = data; renderShield(); } });

  const ENGINE_NAMES = { duckduckgo: 'DuckDuckGo', google: 'Google', bing: 'Bing', yandex: 'Яндекс', startpage: 'Startpage', ecosia: 'Ecosia' };
  function engineName(id) {
    if (id === 'yandex' && document.documentElement.lang === 'en') return 'Yandex';
    return ENGINE_NAMES[id] || id;
  }
  window.__ibReady = true;
})();
