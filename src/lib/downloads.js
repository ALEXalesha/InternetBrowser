// Менеджер загрузок главного процесса. Работает с объектом загрузки Electron (DownloadItem)
// через его методы, поэтому законы проверяют его на подделке без окна: файл всегда ложится
// в папку «Загрузки» под свободным именем, список и состояние пишутся в хранилище.
'use strict';

const fs = require('fs');
const path = require('path');
const { targetPath } = require('../core/downloads');

function createDownloads({ store, dir, exists = (p) => fs.existsSync(p), onChange = () => {}, now = () => Date.now() }) {
  const live = new Map();
  const reserved = new Set();

  /** Новая загрузка: имя, путь, запись в список. Возвращает id записи. */
  function track(item) {
    const file = targetPath(dir(), item.getFilename(), (p) => reserved.has(p) || exists(p));
    reserved.add(file);
    item.setSavePath(file);
    const id = store.addDownload({ url: item.getURL(), filename: path.basename(file), path: file, total: item.getTotalBytes(), started: now(), mime: item.getMimeType() });
    live.set(id, item);
    let last = 0;
    item.on('updated', (_e, state) => {
      const t = now();
      if (t - last < 250 && state === 'progressing') return;
      last = t;
      store.updateDownload(id, { state: item.isPaused() ? 'paused' : state, received: item.getReceivedBytes(), total: item.getTotalBytes() });
      onChange(id);
    });
    item.once('done', (_e, state) => {
      store.updateDownload(id, { state, received: item.getReceivedBytes(), total: item.getTotalBytes(), finished: now() });
      live.delete(id);
      reserved.delete(file);
      onChange(id);
    });
    onChange(id);
    return id;
  }

  /** cancel, pause, resume - для идущей загрузки; remove - убрать запись из списка. */
  function act(id, action) {
    const item = live.get(id);
    if (action === 'remove') {
      if (item) return false;
      store.removeDownload(id);
      onChange(id);
      return true;
    }
    if (!item) return false;
    if (action === 'cancel') item.cancel();
    else if (action === 'pause' && !item.isPaused()) item.pause();
    else if (action === 'resume' && item.canResume()) item.resume();
    else return false;
    if (action !== 'cancel') {
      store.updateDownload(id, { state: item.isPaused() ? 'paused' : 'progressing' });
      onChange(id);
    }
    return true;
  }

  /** Список для страницы загрузок: у готового файла, которого больше нет, состояние missing. */
  function list() {
    return store.listDownloads().map((d) => {
      if (live.has(d.id) && d.state !== 'paused') return { ...d, state: 'progressing' };
      if (d.state === 'completed' && !exists(d.path)) return { ...d, state: 'missing' };
      if (d.state === 'progressing' && !live.has(d.id)) return { ...d, state: 'interrupted' };
      return d;
    });
  }

  function active() {
    return live.size;
  }

  return { track, act, list, active };
}

module.exports = { createDownloads };
