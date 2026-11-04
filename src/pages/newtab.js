// Новая вкладка: часы, поиск, быстрые ссылки, счётчик блокировок. Значки ссылок - из своего
// хранилища (data:), иначе первая буква: страница сама в сеть не ходит.
'use strict';
const P = window.IBPage;
const $ = (id) => document.getElementById(id);

P.start(async (info) => {
  const params = new URLSearchParams(location.search);
  if (params.get('error')) {
    $('error').hidden = false;
    $('error-text').textContent = P.t('errorText', { url: params.get('url') || '', error: params.get('error') });
    $('retry').addEventListener('click', () => { location.href = params.get('url'); });
  }
  const tick = () => {
    const d = new Date();
    $('clock').textContent = d.toLocaleTimeString(info.lang === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
    $('date').textContent = d.toLocaleDateString(info.lang === 'en' ? 'en-GB' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  tick();
  setInterval(tick, 5000);

  let data = await window.ib.call('newtab');
  const engine = () => (P.info().engines.find((e) => e.id === data.engine) || P.info().engines[0]).name;
  $('q').placeholder = P.t('newtabSearch', { engine: engine() });
  $('search').addEventListener('submit', (e) => { e.preventDefault(); if ($('q').value.trim()) window.ib.call('navigate', $('q').value); });
  if (!params.get('error')) $('q').focus();

  async function renderLinks() {
    const icons = await window.ib.call('favicons', data.links.map((l) => P.host(l.url)));
    $('links').innerHTML = data.links.map((l) => {
      const ic = icons[P.host(l.url)];
      return `<a class="tile" href="${P.esc(l.url)}" title="${P.esc(l.url)}"><span class="letter">${ic ? `<img src="${P.esc(ic)}" alt="">` : P.esc((l.title || P.host(l.url) || '?').trim()[0].toUpperCase())}</span><span class="name">${P.esc(l.title)}</span></a>`;
    }).join('');
    $('blocked').textContent = P.t('newtabBlocked', { n: data.blocked });
  }
  await renderLinks();

  let draft = null;
  function renderEditor() {
    $('edit-rows').innerHTML = draft.map((l, i) => `<div class="edit-row"><span class="ellipsis">${P.esc(l.title)} <span class="dim small">${P.esc(l.url)}</span></span><button type="button" class="btn danger" data-rm="${i}">${P.esc(P.t('linkRemove'))}</button></div>`).join('');
    for (const b of document.querySelectorAll('[data-rm]')) b.addEventListener('click', () => { draft.splice(Number(b.dataset.rm), 1); renderEditor(); });
  }
  $('edit').addEventListener('click', () => { draft = data.links.map((l) => ({ ...l })); renderEditor(); $('editor').hidden = false; $('edit').hidden = true; });
  $('add').addEventListener('click', () => {
    let url = $('new-url').value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { url = new URL(url).href; } catch { return; }
    draft.push({ title: $('new-title').value.trim() || P.host(url), url });
    $('new-title').value = '';
    $('new-url').value = '';
    renderEditor();
  });
  $('editor').addEventListener('submit', async (e) => {
    e.preventDefault();
    await window.ib.call('settingsSet', { links: draft });
    data = await window.ib.call('newtab');
    $('editor').hidden = true;
    $('edit').hidden = false;
    renderLinks();
  });
  P.on(async (msg) => {
    if (msg.type === 'settings') { data = await window.ib.call('newtab'); $('q').placeholder = P.t('newtabSearch', { engine: engine() }); renderLinks(); }
  });
});
