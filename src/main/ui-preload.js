// Мост интерфейса окна (полоса вкладок и всплывающий слой): только вызовы ui:* и
// сообщения из списка. Главный процесс ещё раз проверяет, что вызов пришёл от интерфейса.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['ui:state', 'ui:settings', 'ui:focusAddress', 'ui:find', 'ui:found', 'ui:popupRequest', 'ui:escape', 'ui:suggestClosed', 'ov:show', 'ov:hide', 'ov:select', 'ov:update'];

if (location.protocol === 'ib:' && location.hostname === 'ui') {
  contextBridge.exposeInMainWorld('ibui', {
    call: (name, ...args) => ipcRenderer.invoke(`ui:${name}`, ...args),
    on: (channel, fn) => {
      if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
    },
  });
}
