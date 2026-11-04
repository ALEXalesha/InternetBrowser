// Запуск настоящего браузера для законов окна: невидимое окно (IB_TEST=1), свой профиль во
// временной папке, весь трафик - через сервер-прокси теста, списки фильтров - с него же.
'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.IB_ROOT || path.join(__dirname, '..', '..');

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ib-${name}-`));
}

async function launch(server, { dir = tmp('profile'), env = {}, lang = 'ru-RU', args = [] } = {}) {
  const downloads = env.IB_DOWNLOADS || tmp('downloads');
  const app = await electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: [ROOT, `--user-data-dir=${dir}`, '--no-sandbox', `--lang=${lang}`, ...args],
    env: {
      ...process.env,
      IB_TEST: '1',
      IB_PROXY: `127.0.0.1:${server.port}`,
      IB_LIST_URLS: 'http://lists.test/easylist.txt,http://lists.test/easyprivacy.txt',
      IB_DOWNLOADS: downloads,
      IB_CHROME_DIR: path.join(dir, 'no-chrome'),
      ...env,
    },
  });
  await app.firstWindow();
  const ui = await tabPage(app, /^ib:\/\/ui\/index\.html/);
  await ui.waitForFunction(() => window.__ibReady === true);
  return { app, ui, dir, downloads };
}

/** Подождать, пока скачаются списки с сервера теста (движок с правилами *.test). */
async function waitLists(app) {
  await expect.poll(() => app.evaluate(() => globalThis.ibTest.listsState().updated), { timeout: 20000 }).toBeGreaterThan(0);
}

/** Страница вкладки по адресу (регулярка): Playwright видит каждый WebContentsView отдельно. */
async function tabPage(app, re) {
  let found = null;
  await expect.poll(() => {
    found = app.windows().find((p) => re.test(p.url()));
    return !!found;
  }, { timeout: 15000 }).toBe(true);
  await found.waitForLoadState('domcontentloaded');
  return found;
}

async function go(ui, text) {
  await ui.click('#address');
  await ui.fill('#address', text);
  await ui.press('#address', 'Enter');
}

/** Нажать элемент в виде вкладки или всплывающем слое: сам элемент, без ожидания кадра. */
const tap = (locator) => locator.evaluate((el) => el.click());

const state = (app) => app.evaluate(() => globalThis.ibTest.browser.state());
const tabs = (app) => app.evaluate(() => globalThis.ibTest.browser.tabs());
const command = (app, name, arg) => app.evaluate((_e, a) => globalThis.ibTest.browser.command(a[0], a[1]), [name, arg]);

module.exports = { ROOT, tmp, launch, waitLists, tabPage, go, tap, state, tabs, command };
