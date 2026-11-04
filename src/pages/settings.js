// Настройки: тема, язык, поисковик, блокировка, списки фильтров, импорт из Chrome, данные.
'use strict';
const P = window.IBPage;
const $ = (id) => document.getElementById(id);

P.start(async () => {
  let s = P.info().settings;

  const set = async (patch) => { s = await window.ib.call('settingsSet', patch); render(); };

  function seg(el, items, value, key) {
    el.innerHTML = items.map(([id, label]) => `<button data-v="${P.esc(id)}" class="${id === value ? 'on' : ''}">${P.esc(label)}</button>`).join('');
    for (const b of el.querySelectorAll('button')) b.addEventListener('click', () => set({ [key]: b.dataset.v }));
  }

  function render() {
    const info = P.info();
    const names = P.t('themeNames').split('|');
    seg($('theme'), info.themes.map((id, i) => [id, names[i]]), s.theme, 'theme');
    seg($('lang'), [['auto', P.t('langAuto')], ['ru', 'Русский'], ['en', 'English']], s.lang, 'lang');
    $('engine').innerHTML = info.engines.map((e) => `<option value="${e.id}" ${e.id === s.engine ? 'selected' : ''}>${P.esc(e.name)}</option>`).join('');
    $('bookmarksBar').checked = s.bookmarksBar;
    $('blockingOn').checked = s.blocking;
    $('cosmetic').checked = s.cosmetic;
    $('listsAuto').checked = s.listsAutoUpdate;
    $('restoreTabs').checked = s.restoreTabs;
    $('about-text').textContent = P.t('aboutText', { v: info.version, chrome: info.chrome });
  }

  const flag = (id, key) => $(id).addEventListener('change', () => set({ [key]: $(id).checked }));
  flag('bookmarksBar', 'bookmarksBar');
  flag('blockingOn', 'blocking');
  flag('cosmetic', 'cosmetic');
  flag('listsAuto', 'listsAutoUpdate');
  flag('restoreTabs', 'restoreTabs');
  $('engine').addEventListener('change', () => set({ engine: $('engine').value }));

  async function lists(state) {
    const st = state || await window.ib.call('lists');
    const when = st.updated ? new Date(st.updated).toLocaleString(P.info().lang === 'en' ? 'en-GB' : 'ru-RU') : P.t('setListsNever');
    let text = P.t('setListsState', { from: P.t(`listsFrom_${st.from}`), when });
    if (st.updating) text = P.t('setListsUpdating');
    else if (st.error) text += ' ' + P.t('setListsFail', { error: st.error });
    $('lists-state').textContent = text;
    $('lists-state').className = `small ${st.error ? 'bad' : 'dim'}`;
    $('lists-now').disabled = !!st.updating;
  }
  $('lists-now').addEventListener('click', async () => {
    $('lists-state').textContent = P.t('setListsUpdating');
    $('lists-now').disabled = true;
    await lists(await window.ib.call('listsUpdate'));
  });

  async function sites() {
    const off = await window.ib.call('sitesOff');
    $('sites').innerHTML = off.length
      ? off.map((x) => `<div class="setrow"><span class="ellipsis">${P.esc(x)}</span><button class="btn" data-site="${P.esc(x)}">${P.esc(P.t('setSiteOn'))}</button></div>`).join('')
      : `<p class="note">${P.esc(P.t('setSitesNone'))}</p>`;
    for (const b of document.querySelectorAll('[data-site]')) b.addEventListener('click', async () => { await window.ib.call('siteOn', b.dataset.site); sites(); });
  }

  async function profiles() {
    const list = await window.ib.call('chromeProfiles');
    $('profile').innerHTML = list.map((p) => `<option value="${P.esc(p.path)}">${P.esc(p.name)}${list.some((q) => q.root !== p.root) ? ` (${P.esc(p.root)})` : ''}</option>`).join('');
    $('profile').hidden = !list.length;
    $('import-btn').disabled = !list.length;
    if (!list.length) $('import-result').textContent = P.t('setImportNone');
  }
  $('import-btn').addEventListener('click', async () => {
    $('import-btn').disabled = true;
    const res = await window.ib.call('chromeImport', $('profile').value);
    $('import-btn').disabled = false;
    $('import-result').className = `small ${res.error ? 'bad' : 'ok'}`;
    $('import-result').textContent = res.error ? P.t('setImportFail', { error: res.error }) : P.t('setImportDone', { b: res.bookmarks, h: res.history });
  });

  $('clear-history').addEventListener('click', async () => {
    if (!confirm(P.t('historyClearConfirm'))) return;
    await window.ib.call('historyClear');
  });

  P.on((msg) => {
    if (msg.type === 'settings') { s = P.info().settings; render(); }
    if (msg.type === 'lists') lists();
  });
  render();
  await Promise.all([lists(), sites(), profiles()]);
  if (location.hash) { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }
});
