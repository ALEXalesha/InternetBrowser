// Загрузки: свой список; файлы лежат в обычной папке «Загрузки».
'use strict';
const P = window.IBPage;
const $ = (id) => document.getElementById(id);

function size(n) {
  const lang = P.info().lang;
  const u = lang === 'en' ? ['B', 'KB', 'MB', 'GB'] : ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = Math.max(0, n || 0);
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(v < 10 ? 1 : 0);
  return `${lang === 'en' ? s : s.replace('.', ',')} ${u[i]}`;
}

P.start(async () => {
  async function load() {
    const { list, dir } = await window.ib.call('downloads');
    $('folder').textContent = `${P.t('downloadsFolder')}: ${dir}`;
    if (!list.length) { $('list').innerHTML = `<div class="empty">${P.esc(P.t('downloadsEmpty'))}</div>`; return; }
    $('list').innerHTML = list.map((d) => {
      const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
      const live = d.state === 'progressing' || d.state === 'paused';
      const btn = (act, ic, key) => `<button class="icon-btn" data-act="${act}" data-id="${d.id}" title="${P.esc(P.t(key))}">${P.icon(ic)}</button>`;
      const actions = live
        ? (d.state === 'paused' ? btn('resume', 'play', 'downloadResume') : btn('pause', 'pause', 'downloadPause')) + btn('cancel', 'close', 'downloadCancel')
        : (d.state === 'completed' ? btn('open', 'external', 'downloadOpen') + btn('show', 'folder', 'downloadShow') : '') + btn('remove', 'trash', 'downloadRemove');
      return `<div class="li" data-dl="${d.id}" data-state="${d.state}"><span class="fav">${P.icon('download')}</span><div class="main"><div class="ellipsis" title="${P.esc(d.path)}">${P.esc(d.filename)}</div>
        <div class="dim small ellipsis"><span class="st">${P.esc(P.t(`dl_${d.state}`))}</span> · ${P.esc(live && d.total ? `${size(d.received)} / ${size(d.total)}` : size(d.received || d.total))} · ${P.esc(P.host(d.url))}</div>
        ${live ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}</div>${actions}</div>`;
    }).join('');
    for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', async () => { await window.ib.call('downloadAct', Number(b.dataset.id), b.dataset.act); load(); });
  }
  $('clear').addEventListener('click', async () => { await window.ib.call('downloadsClear'); load(); });
  P.on((msg) => { if (msg.type === 'downloads') load(); });
  await load();
});
