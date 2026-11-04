// Закладки: дерево с папками, поиск, переименование, перенос выше/ниже и удаление.
'use strict';
const P = window.IBPage;
const $ = (id) => document.getElementById(id);

P.start(async () => {
  const open = new Set([1, 2]);
  let tree = [];
  let icons = {};
  let editing = null;

  const rootTitle = (n) => (n.id === 1 ? P.t('bookmarksBar') : P.t('otherBookmarks'));

  async function load() {
    const q = $('q').value.trim();
    tree = q ? null : await window.ib.call('bookmarksTree');
    const flat = q ? await window.ib.call('bookmarksSearch', q) : [];
    const urls = [];
    const walk = (n) => { if (n.url) urls.push(n.url); (n.children || []).forEach(walk); };
    (tree || flat).forEach(walk);
    const want = [...new Set(urls.map(P.host).filter((h) => h && !(h in icons)))];
    if (want.length) Object.assign(icons, await window.ib.call('favicons', want));
    render(q ? flat : null);
  }

  function item(n, siblings, idx) {
    const isRoot = n.parent === null;
    const title = isRoot ? rootTitle(n) : n.title;
    const ic = n.kind === 'folder' ? P.icon('folder') : icons[P.host(n.url)] ? `<img src="${P.esc(icons[P.host(n.url)])}" alt="">` : P.icon('globe');
    const twist = n.kind === 'folder' ? `<button class="twist" data-twist="${n.id}">${P.icon(open.has(n.id) ? 'down' : 'forward')}</button>` : '<span class="twist"></span>';
    let main;
    if (editing === n.id) {
      main = `<input class="t" data-title="${n.id}" value="${P.esc(n.title)}">${n.kind === 'url' ? `<input class="t" data-url="${n.id}" value="${P.esc(n.url)}">` : ''}<button class="btn primary" data-save="${n.id}">${P.esc(P.t('save'))}</button>`;
    } else {
      main = `<div class="main">${n.kind === 'url' ? `<a href="${P.esc(n.url)}" class="ellipsis" title="${P.esc(n.url)}">${P.esc(n.title || n.url)}</a><div class="dim small ellipsis">${P.esc(n.url)}</div>` : `<span class="ellipsis">${P.esc(title)}</span>`}</div>`;
    }
    const actions = isRoot ? '' : `<span class="actions">
      <button class="icon-btn" data-move="${n.id}" data-dir="-1" title="${P.esc(P.t('moveUp'))}" ${idx === 0 ? 'disabled' : ''}>${P.icon('up')}</button>
      <button class="icon-btn" data-move="${n.id}" data-dir="1" title="${P.esc(P.t('moveDown'))}" ${idx === siblings - 1 ? 'disabled' : ''}>${P.icon('down')}</button>
      <button class="icon-btn" data-edit="${n.id}" title="${P.esc(P.t('edit'))}">${P.icon('edit')}</button>
      <button class="icon-btn" data-rm="${n.id}" title="${P.esc(P.t('remove'))}">${P.icon('trash')}</button></span>`;
    const row = `<div class="li">${twist}<span class="fav">${ic}</span>${main}${actions}</div>`;
    if (n.kind !== 'folder') return `<div data-id="${n.id}" data-pos="${n.position}" data-parent="${n.parent}">${row}</div>`;
    const kids = open.has(n.id) ? `<div class="kids">${n.children.length ? n.children.map((c, i) => item(c, n.children.length, i)).join('') : `<div class="li dim small">${P.esc(P.t('emptyFolder'))}</div>`}</div>` : '';
    return `<div class="folder" data-id="${n.id}" data-pos="${n.position}" data-parent="${n.parent}">${row}${kids}</div>`;
  }

  function render(flat) {
    if (flat) {
      $('tree').innerHTML = flat.length ? flat.map((n, i) => item(n, flat.length, i)).join('') : `<div class="empty">${P.esc(P.t('historyNothing'))}</div>`;
    } else {
      $('tree').innerHTML = tree.map((r, i) => item(r, tree.length, i)).join('');
    }
    bind();
  }

  function bind() {
    for (const b of document.querySelectorAll('[data-twist]')) b.addEventListener('click', () => { const id = Number(b.dataset.twist); if (open.has(id)) open.delete(id); else open.add(id); load(); });
    for (const b of document.querySelectorAll('[data-rm]')) b.addEventListener('click', async () => { await window.ib.call('bookmarkRemove', Number(b.dataset.rm)); load(); });
    for (const b of document.querySelectorAll('[data-edit]')) b.addEventListener('click', () => { editing = Number(b.dataset.edit); load(); });
    for (const b of document.querySelectorAll('[data-save]')) {
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.save);
        const patch = { title: document.querySelector(`[data-title="${id}"]`).value };
        const u = document.querySelector(`[data-url="${id}"]`);
        if (u) patch.url = u.value.trim();
        await window.ib.call('bookmarkUpdate', id, patch);
        editing = null;
        load();
      });
    }
    for (const b of document.querySelectorAll('[data-move]')) {
      b.addEventListener('click', async () => {
        const el = b.closest('[data-id]');
        const pos = Number(el.dataset.pos) + Number(b.dataset.dir);
        await window.ib.call('bookmarkMove', Number(b.dataset.move), Number(el.dataset.parent), pos);
        load();
      });
    }
  }

  let timer = null;
  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 120); });
  $('add-folder').addEventListener('click', async () => {
    const id = await window.ib.call('folderAdd', { parent: 1, title: P.t('folderNew') });
    editing = id;
    open.add(1);
    load();
  });
  P.on((msg) => { if (msg.type === 'bookmarks' && editing === null) load(); });
  await load();
});
