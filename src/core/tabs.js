// Модель полосы вкладок без Electron: порядок, активная вкладка, закрытые (для «вернуть
// закрытую»). Окно никогда не остаётся без вкладок: закрыли последнюю - открылась новая.
'use strict';

const { NEWTAB } = require('./pages');

const MAX_CLOSED = 25;

function createTabs() {
  let seq = 0;
  const list = [];
  const closed = [];
  let active = null;

  const index = (id) => list.findIndex((t) => t.id === id);

  function open(url = NEWTAB, { activate = true, after = active } = {}) {
    const id = ++seq;
    const at = index(after);
    const tab = { id, url, title: '' };
    if (at < 0) list.push(tab); else list.splice(at + 1, 0, tab);
    if (activate || active === null) active = id;
    return id;
  }

  function activateTab(id) {
    if (index(id) < 0) return false;
    active = id;
    return true;
  }

  /** Закрыть вкладку. Активной становится соседняя справа, а у крайней правой - слева. */
  function close(id) {
    const i = index(id);
    if (i < 0) return null;
    const [tab] = list.splice(i, 1);
    closed.push({ url: tab.url, title: tab.title, index: i });
    if (closed.length > MAX_CLOSED) closed.shift();
    let opened = null;
    if (!list.length) {
      opened = open(NEWTAB);
    } else if (active === id) {
      active = list[Math.min(i, list.length - 1)].id;
    }
    return { closed: id, opened };
  }

  /** Вернуть последнюю закрытую вкладку на прежнее место. */
  function reopen() {
    const c = closed.pop();
    if (!c) return null;
    const id = ++seq;
    list.splice(Math.min(c.index, list.length), 0, { id, url: c.url, title: c.title });
    active = id;
    return id;
  }

  function move(id, to) {
    const i = index(id);
    if (i < 0) return false;
    const [tab] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, tab);
    return true;
  }

  /** Соседняя по кругу (step = 1 вперёд, -1 назад). */
  function cycle(step) {
    if (!list.length) return null;
    const i = index(active);
    active = list[((i + step) % list.length + list.length) % list.length].id;
    return active;
  }

  /** Ctrl+1..8 - вкладка по номеру, Ctrl+9 - последняя. */
  function byNumber(n) {
    if (!list.length) return null;
    const t = n >= 9 ? list[list.length - 1] : list[n - 1];
    if (!t) return null;
    active = t.id;
    return active;
  }

  function update(id, patch) {
    const t = list[index(id)];
    if (!t) return false;
    if (typeof patch.url === 'string') t.url = patch.url;
    if (typeof patch.title === 'string') t.title = patch.title;
    return true;
  }

  return {
    open, close, reopen, move, cycle, byNumber, update,
    activate: activateTab,
    get: (id) => list[index(id)] || null,
    list: () => list.map((t) => ({ ...t })),
    ids: () => list.map((t) => t.id),
    active: () => active,
    closedCount: () => closed.length,
  };
}

module.exports = { createTabs, MAX_CLOSED };
