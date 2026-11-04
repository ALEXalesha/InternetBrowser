// Общее для своих страниц: строки, тема, значки и мост к главному процессу (window.ib).
'use strict';
window.IBPage = (() => {
  const listeners = [];
  let info = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function t(k, v) {
    const s = info && info.strings[k];
    if (s === undefined) return k;
    return v ? s.replace(/\{(\w+)\}/g, (m, x) => (v[x] === undefined ? m : v[x])) : s;
  }

  function apply() {
    document.documentElement.dataset.theme = info.settings.theme;
    document.documentElement.lang = info.lang;
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
    for (const el of document.querySelectorAll('[data-tip]')) el.title = t(el.dataset.tip);
    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = window.IBIcons.icon(el.dataset.icon);
    const title = document.body.dataset.title;
    if (title) document.title = t(title);
  }

  async function start(onReady) {
    info = await window.ib.call('init');
    apply();
    window.ib.on(async (msg) => {
      if (msg.type === 'settings') { info = await window.ib.call('init'); apply(); }
      for (const fn of listeners) fn(msg);
    });
    await onReady(info);
    document.body.dataset.ready = '1';
  }

  function dayLabel(ms) {
    const d = new Date(ms);
    const today = new Date();
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return t('today');
    if (same(d, y)) return t('yesterday');
    return d.toLocaleDateString(info.lang === 'en' ? 'en-GB' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  function timeLabel(ms) {
    return new Date(ms).toLocaleTimeString(info.lang === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function host(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  return {
    start, t, esc, dayLabel, timeLabel, host,
    on: (fn) => listeners.push(fn),
    icon: (n) => window.IBIcons.icon(n),
    info: () => info,
  };
})();
