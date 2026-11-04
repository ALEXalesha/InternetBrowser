// Разрешения сайтов (камера, микрофон, уведомления, место...). Безвредное разрешается сразу,
// остальное спрашивается у пользователя один раз на сайт за запуск. Без ответа - отказ.
'use strict';

const { siteOf } = require('../core/sites');

const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management', 'speaker-selection']);
const ASK = new Set(['media', 'notifications', 'geolocation', 'midi', 'midiSysex', 'clipboard-read', 'display-capture']);

function createPermissions({ ask }) {
  const memory = new Map();
  const key = (site, perm) => `${site} ${perm}`;

  /** Решение для запроса: callback(true|false). ask(site, perm) -> Promise<boolean>. */
  async function request(url, perm) {
    if (ALWAYS.has(perm)) return true;
    const site = siteOf(url);
    if (!site || !ASK.has(perm)) return false;
    const k = key(site, perm === 'midiSysex' ? 'midi' : perm);
    if (memory.has(k)) return memory.get(k);
    let ok = false;
    try { ok = (await ask(site, perm)) === true; } catch { ok = false; }
    memory.set(k, ok);
    return ok;
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
