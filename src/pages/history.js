// История: поиск по словам (в адресе и заголовке), по дням, удаление записи и очистка.
'use strict';
const P = window.IBPage;
const $ = (id) => document.getElementById(id);

P.start(async () => {
  let rows = [];
  let query = '';
  let timer = null;
  let icons = {};

  async function load(reset) {
    const part = await window.ib.call('historySearch', query, reset ? 0 : rows.length);
    rows = reset ? part : rows.concat(part);
    const want = [...new Set(part.map((r) => P.host(r.url)).filter((h) => h && !(h in icons)))];
    if (want.length) Object.assign(icons, await window.ib.call('favicons', want));
    $('more').hidden = part.length < 100;
    render();
  }

  function render() {
    if (!rows.length) { $('list').innerHTML = `<div class="empty">${P.esc(P.t(query ? 'historyNothing' : 'historyEmpty'))}</div>`; return; }
    let day = '';
    const html = [];
    rows.forEach((r, i) => {
      const d = P.dayLabel(r.lastVisit);
      if (d !== day) { day = d; html.push(`<div class="group">${P.esc(d)}</div>`); }
      const ic = icons[P.host(r.url)];
      html.push(`<div class="li" data-i="${i}"><span class="time">${P.esc(P.timeLabel(r.lastVisit))}</span><span class="fav">${ic ? `<img src="${P.esc(ic)}" alt="">` : P.icon('globe')}</span><div class="main"><a href="${P.esc(r.url)}" class="ellipsis" title="${P.esc(r.url)}">${P.esc(r.title || r.url)}</a><div class="dim small ellipsis">${P.esc(P.host(r.url) || r.url)} · ${P.esc(P.t('historyVisits', { n: r.visits }))}</div></div><button class="icon-btn" data-del="${i}" title="${P.esc(P.t('historyDelete'))}">${P.icon('trash')}</button></div>`);
    });
    $('list').innerHTML = html.join('');
    for (const b of document.querySelectorAll('[data-del]')) {
      b.addEventListener('click', async () => {
        const r = rows[Number(b.dataset.del)];
        await window.ib.call('historyDelete', [r.url]);
        rows = rows.filter((x) => x !== r);
        render();
      });
    }
  }

  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = $('q').value; load(true); }, 120); });
  $('more').addEventListener('click', () => load(false));
  $('clear').addEventListener('click', async () => {
    if (!confirm(P.t('historyClearConfirm'))) return;
    await window.ib.call('historyClear');
    load(true);
  });
  $('q').focus();
  await load(true);
});
