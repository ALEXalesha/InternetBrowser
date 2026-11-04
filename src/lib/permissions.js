// Разрешения сайтов (камера, микрофон, уведомления, место...). Безвредное разрешается сразу,
// остальное спрашивается у пользователя один раз на сайт за запуск. Без ответа - отказ.
'use strict';

const { siteOf } = require('../core/sites');

const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management', 'speaker-selection']);
const ASK = new Set(['media', 'notifications', 'geolocation', 'midi', 'midiSysex', 'clipboard-read', 'display-capture']);

function createPermissions({ ask }) {
  const memory = new Map();
  const pending = new Map();
  const key = (site, perm) => `${site} ${perm}`;

  /**
   * Решение для запроса. ask(site, perm) -> Promise<true | false | null>: null - вопрос закрыли
   * без ответа (перекрыло другое окно, сменили вкладку); это отказ сейчас, но не запоминается.
   * Одинаковые запросы, пришедшие, пока вопрос открыт, ждут тот же ответ.
   */
  async function request(url, perm) {
    if (ALWAYS.has(perm)) return true;
    const site = siteOf(url);
    if (!site || !ASK.has(perm)) return false;
    const k = key(site, perm);
    if (memory.has(k)) return memory.get(k);
    if (pending.has(k)) return pending.get(k);
    const p = (async () => {
      let ans = null;
      try { ans = await ask(site, perm); } catch { ans = null; }
      if (ans === true || ans === false) memory.set(k, ans);
      return ans === true;
    })();
    pending.set(k, p);
    try { return await p; } finally { pending.delete(k); }
  }

  /** Проверка без вопроса (permission check handler): только то, что уже разрешено. */
  function check(url, perm) {
    if (ALWAYS.has(perm)) return true;
    const site = siteOf(url);
    return !!site && memory.get(key(site, perm)) === true;
  }

  return { request, check, forget: () => memory.clear() };
}

module.exports = { createPermissions, ALWAYS, ASK };
