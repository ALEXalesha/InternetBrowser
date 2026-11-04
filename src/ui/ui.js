// Полоса вкладок и адресная строка. Состояние приходит из главного процесса (ui:state),
// действия уходят туда же (ibui.call). Сама полоса ничего не хранит и в сеть не ходит.
'use strict';
(async () => {
  const { icon } = window.IBIcons;
  const $ = (id) => document.getElementById(id);
  let S = {};
  let state = null;
  let suggest = [];
  let selected = 0;
  let editing = false;
  let omniTimer = null;

  const t = (k, v) => {
    const s = S[k];
    if (s === undefined) return k;
    return v ? s.replace(/\{(\w+)\}/g, (m, x) => (v[x] === undefined ? m : v[x])) : s;
  };

  function applySettings(set) {
    document.documentElement.dataset.theme = set.theme;
    document.documentElement.lang = set.lang;
    if (set.strings) S = set.strings;
    for (const el of document.querySelectorAll('[data-tip]')) el.title = t(el.dataset.tip);
    for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
  }

  const init = await window.ibui.call('init');
  S = init.strings;
  applySettings(init.settings);
  document.body.classList.add(`os-${init.platform}`);
  $('back').innerHTML = icon('back');
  $('forward').innerHTML = icon('forward');
  $('reload').innerHTML = icon('reload');
  $('newtab').innerHTML = icon('plus');
  $('star').innerHTML = icon('star');
  $('shield').insertAdjacentHTML('afterbegin', icon('shield'));
  $('downloads').insertAdjacentHTML('afterbegin', icon('download'));
  $('menu').innerHTML = icon('menu');
  $('find-prev').innerHTML = icon('up');
  $('find-next').innerHTML = icon('down');
  $('find-close').innerHTML = icon('close');

  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const call = (...a) => window.ibui.call(...a);

  // ---------- вкладки ----------
  const PAGE_ICON = { newtab: 'newtab', history: 'history', bookmarks: 'bookmarks', downloads: 'download', settings: 'gear' };
  function favHtml(tab) {
    if (tab.loading && !tab.page) return '<span class="spinner"></span>';
    if (tab.page) return icon(PAGE_ICON[tab.page] || 'globe');
    if (tab.favicon) return `<img src="${escapeAttr(tab.favicon)}" alt="">`;
    return icon('globe');
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  let dragId = null;
  function renderTabs() {
    const box = $('tabs');
    const avail = $('strip').clientWidth - 90;
    const narrow = state.tabs.length * 100 > avail;
    box.innerHTML = '';
    for (const tab of state.tabs) {
      const el = document.createElement('div');
      el.className = `tab${tab.id === state.active ? ' active' : ''}${narrow ? ' narrow' : ''}`;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab.id === state.active));
      el.dataset.id = tab.id;
      el.title = tab.title;
      el.draggable = true;
      el.innerHTML = `<span class="fav">${favHtml(tab)}</span><span class="title">${escapeHtml(tab.title)}</span>${tab.audible ? icon('sound', 'snd') : ''}<button class="x" title="${escapeAttr(t('closeTab'))}">${icon('close')}</button>`;
      el.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !e.target.closest('.x')) call('tab', 'activate', tab.id);
      });
      el.addEventListener('auxclick', (e) => { if (e.button === 1) call('tab', 'close', tab.id); });
      el.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); call('tab', 'close', tab.id); });
      el.addEventListener('dragstart', (e) => { dragId = tab.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragend', () => { dragId = null; render(); });
      el.addEventListener('dragover', (e) => {
        if (dragId === null || dragId === tab.id) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        el.classList.toggle('drop-before', e.clientX < r.left + r.width / 2);
        el.classList.toggle('drop-after', e.clientX >= r.left + r.width / 2);
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragId === null) return;
        const ids = state.tabs.map((x) => x.id).filter((x) => x !== dragId);
        let at = ids.indexOf(tab.id);
        if (el.classList.contains('drop-after')) at++;
        call('tab', 'move', dragId, at);
      });
      box.appendChild(el);
    }
  }

  // ---------- строка и кнопки ----------
  function renderNav() {
    const n = state.nav;
    $('back').disabled = !n.canBack;
    $('forward').disabled = !n.canForward;
    $('reload').innerHTML = icon(n.loading ? 'stop' : 'reload');
    $('reload').title = t(n.loading ? 'stop' : 'reload');
    if (!editing && document.activeElement !== $('address')) $('address').value = n.display;
    const oi = $('omni-icon');
    oi.className = `omni-icon${n.secure && !n.page ? ' secure' : ''}`;
    oi.innerHTML = icon(n.page ? 'search' : n.secure ? 'lock' : n.url ? 'globe' : 'search');
    $('star').hidden = !n.canBookmark;
    $('star').classList.toggle('on', n.bookmarked);
    $('star').title = t(n.bookmarked ? 'bookmarkEdit' : 'bookmarkAdd');
    const z = Math.round(Math.pow(1.2, n.zoom) * 100);
    $('zoom').hidden = z === 100;
    $('zoom').textContent = `${z} %`;
    const off = !n.blocking || (n.site && !n.siteOn);
    $('shield').classList.toggle('off', !!off);
    $('shield').firstElementChild.outerHTML = icon(off ? 'shieldOff' : 'shield');
    $('blocked').hidden = !n.blocked || off;
    $('blocked').textContent = n.blocked > 999 ? '999+' : String(n.blocked);
    $('dl-dot').hidden = !state.downloads;
  }

  function renderBar() {
    const bar = $('bar');
    bar.hidden = !state.bar;
    if (!state.bar) return;
    bar.innerHTML = '';
    if (!state.bar.length) { bar.innerHTML = `<span class="bar-empty">${escapeHtml(t('bookmarksBar'))}</span>`; return; }
    for (const b of state.bar) {
      const el = document.createElement('button');
      el.className = 'bm';
      el.title = b.kind === 'url' ? `${b.title}\n${b.url}` : b.title;
      el.innerHTML = `${b.kind === 'folder' ? icon('folder') : b.favicon ? `<img src="${escapeAttr(b.favicon)}" alt="">` : icon('globe')}<span>${escapeHtml(b.title || b.url || '')}</span>`;
      el.addEventListener('click', (e) => {
        if (b.kind === 'folder') call('popup', 'folder', rect(el), b.id);
        else call('open', b.url, e.ctrlKey || e.metaKey ? 'tab' : 'here');
      });
      el.addEventListener('auxclick', (e) => { if (e.button === 1 && b.kind === 'url') call('open', b.url, 'tab'); });
      bar.appendChild(el);
    }
  }

  function render() {
    if (!state) return;
    document.body.classList.toggle('fullscreen', !!state.fullscreen);
    renderTabs();
    renderNav();
    renderBar();
    reportLayout();
  }

  let lastTop = -1;
  function reportLayout() {
    const h = Math.ceil($('chrome').getBoundingClientRect().height);
    if (h !== lastTop) { lastTop = h; call('layout', h); }
  }
  new ResizeObserver(reportLayout).observe($('chrome'));
  window.addEventListener('resize', () => render());

  window.ibui.on('ui:state', (s) => { state = s; render(); });
  window.ibui.on('ui:settings', (set) => { applySettings(set); render(); });
  window.ibui.on('ui:focusAddress', () => { const a = $('address'); a.focus(); a.select(); });
  window.ibui.on('ui:popupRequest', (kind) => {
    if (kind === 'bookmark' && state && state.nav.canBookmark) call('popup', 'bookmark', rect($('star')));
  });
  window.ibui.on('ui:suggestClosed', () => { suggest = []; selected = 0; });

  $('back').addEventListener('click', () => call('command', 'back'));
  $('forward').addEventListener('click', () => call('command', 'forward'));
  $('reload').addEventListener('click', () => call('command', state && state.nav.loading ? 'stop' : 'reload'));
  $('newtab').addEventListener('click', () => call('command', 'newTab'));
  $('star').addEventListener('click', () => call('popup', 'bookmark', rect($('star'))));
  $('shield').addEventListener('click', () => call('popup', 'shield', rect($('shield'))));
  $('downloads').addEventListener('click', () => call('popup', 'downloads', rect($('downloads'))));
  $('menu').addEventListener('click', () => call('popup', 'menu', rect($('menu'))));
  $('strip').addEventListener('dblclick', (e) => { if (e.target === $('strip') || e.target.classList.contains('drag')) call('command', 'newTab'); });

  // ---------- адресная строка ----------
  const addr = $('address');
  addr.addEventListener('focus', () => setTimeout(() => addr.select(), 0));
  addr.addEventListener('input', () => {
    editing = true;
    clearTimeout(omniTimer);
    omniTimer = setTimeout(async () => {
      suggest = addr.value.trim() ? await call('omnibox', addr.value, rect($('omni'))) : [];
      if (!addr.value.trim()) call('omniboxClose');
      selected = 0;
    }, 40);
  });
  addr.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggest.length) return;
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + suggest.length) % suggest.length;
      call('omniboxSelect', selected);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(omniTimer);
      const pick = suggest[selected];
      editing = false;
      if (pick && selected > 0) await call('open', pick.url, e.altKey ? 'tab' : 'here');
      else await call('navigate', addr.value);
      suggest = [];
      addr.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
      suggest = [];
      call('omniboxClose');
      if (state) addr.value = state.nav.display;
      addr.select();
    }
  });
  addr.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === addr) return;
      editing = false;
      call('omniboxClose');
      if (state) addr.value = state.nav.display;
    }, 150);
  });

  // ---------- поиск на странице ----------
  const find = $('find');
  function openFind() { $('findbar').hidden = false; find.focus(); find.select(); reportLayout(); if (find.value) call('find', find.value); }
  function closeFind() { $('findbar').hidden = true; $('find-count').textContent = ''; call('findStop'); reportLayout(); }
  window.ibui.on('ui:find', openFind);
  window.ibui.on('ui:escape', () => { if (!$('findbar').hidden) closeFind(); });
  window.ibui.on('ui:found', (r) => { $('find-count').textContent = r.total ? t('findCount', { i: r.active, n: r.total }) : t('findNone'); });
  find.addEventListener('input', () => { if (find.value) call('find', find.value); else { call('findStop'); $('find-count').textContent = ''; } });
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); call('find', find.value, { forward: !e.shiftKey, findNext: true }); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('find-prev').addEventListener('click', () => call('find', find.value, { forward: false, findNext: true }));
  $('find-next').addEventListener('click', () => call('find', find.value, { forward: true, findNext: true }));
  $('find-close').addEventListener('click', closeFind);

  state = init.state;
  render();
  window.__ibReady = true;
})();
