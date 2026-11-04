// Мост своих страниц браузера (ib://newtab, history...). Обычные сайты его не получают:
// проверка адреса здесь и ещё раз в главном процессе (рамка и адрес отправителя).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'ib:' && window === window.top) {
  contextBridge.exposeInMainWorld('ib', {
    call: (name, ...args) => ipcRenderer.invoke(`page:${name}`, ...args),
    on: (fn) => ipcRenderer.on('page:event', (_e, msg) => fn(msg)),
  });
}
