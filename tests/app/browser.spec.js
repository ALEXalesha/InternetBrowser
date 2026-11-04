// Законы окна: вкладки, адресная строка, блокировка со счётчиком и выключателем на сайте,
// закладки и история, загрузки, импорт из Chrome кнопкой, «ничего не уходит наружу».
'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { start } = require('./server');
const { launch, waitLists, tabPage, go, tap, state, tabs, command, tmp } = require('./helpers');
const { writeUserData } = require('../fixtures/fake-chrome');

let server;
test.beforeAll(async () => { server = await start(); });
test.afterAll(async () => { await server.close(); });

test('окно невидимо, без фокуса и за экраном; новая вкладка открыта; меню окна нет', async () => {
  const { app, ui } = await launch(server);
  try {
    const w = await app.evaluate(({ BrowserWindow }) => {
      const b = BrowserWindow.getAllWindows()[0];
      return { visible: b.isVisible(), focusable: b.isFocusable(), bounds: b.getBounds(), menu: b.isMenuBarVisible() };
    });
    expect(w.visible).toBe(false);
    expect(w.focusable).toBe(false);
    expect(w.bounds.x).toBeLessThan(-10000);
    expect(w.menu).toBe(false);
    const nt = await tabPage(app, /^ib:\/\/newtab\//);
    await expect(nt.locator('body')).toHaveAttribute('data-ready', '1');
    await expect(ui.locator('.tab.active .title')).toHaveText('Новая вкладка');
    expect(await ui.evaluate(() => document.pointerLockElement)).toBeNull();
    expect(await nt.evaluate(() => typeof window.ib)).toBe('object');
  } finally {
    await app.close();
  }
});

test('блокировка: реклама и трекер срезаны, счётчик = 3, косметика спрятала места; выключатель на сайте пускает всё и переживает перезапуск', async () => {
  const dir = tmp('profile');
  let { app, ui } = await launch(server, { dir });
  try {
    await waitLists(app);
    await go(ui, 'site.test/page.html');
    const page = await tabPage(app, /site\.test\/page\.html/);
    await expect(ui.locator('.tab.active .title')).toHaveText('Test site');
    await expect.poll(async () => (await state(app)).nav.blocked).toBe(3);
    await expect(ui.locator('#blocked')).toHaveText('3');
    expect(await page.evaluate(() => window.adsLoaded)).toBe(false);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('banner')).display).catch(() => null)).toBe('none');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('promo')).display).catch(() => null)).toBe('none');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('content')).display)).toBe('block');
    expect(await page.evaluate(() => document.getElementById('ok').naturalWidth)).toBe(1);
    expect(server.hits.some((u) => u.startsWith('http://ads.test/'))).toBe(false);

    // щит: панель показывает число, выключатель выключает блокировку на сайте
    await ui.click('#shield');
    const ov = await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
    await expect(ov.locator('#count')).toHaveText('3');
    await tap(ov.locator('#site-on'));
    await expect.poll(async () => (await state(app)).nav.siteOn).toBe(false);
    await expect.poll(() => page.evaluate(() => window.adsLoaded === true).catch(() => null)).toBe(true);
    await expect.poll(async () => (await state(app)).nav.blocked).toBe(0);
    await expect(ui.locator('#blocked')).toBeHidden();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('banner')).display).catch(() => null)).toBe('block');
    expect(server.hits.some((u) => u === 'http://ads.test/ads.js')).toBe(true);
  } finally {
    await app.close();
  }
  ({ app, ui } = await launch(server, { dir }));
  try {
    await waitLists(app);
    await go(ui, 'site.test/page.html');
    const page = await tabPage(app, /site\.test\/page\.html/);
    await expect.poll(() => page.evaluate(() => window.adsLoaded === true).catch(() => null)).toBe(true);
    expect((await state(app)).nav.siteOn).toBe(false);
    // на другом сайте блокировка работает
    await go(ui, 'other.test');
    const other = await tabPage(app, /other\.test/);
    await expect.poll(async () => (await state(app)).nav.blocked).toBe(1);
    // значок-трекер (<link rel=icon> на чужой адрес из списка) браузер сам не запрашивает
    await other.waitForTimeout(800);
    expect(server.hits.filter((u) => u.startsWith('http://tracker.test/icon.png'))).toEqual([]);
    // включить обратно со страницы настроек
    await command(app, 'settings');
    const set = await tabPage(app, /^ib:\/\/settings\//);
    await expect(set.locator('[data-site="site.test"]')).toBeVisible();
    await tap(set.locator('[data-site="site.test"]'));
    await expect(set.locator('[data-site]')).toHaveCount(0);
    expect(await app.evaluate(() => globalThis.ibTest.store.isBlockingOn('site.test'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('адресная строка: адрес, поиск и подсказки из истории; история и закладки переживают перезапуск', async () => {
  const dir = tmp('profile');
  let { app, ui } = await launch(server, { dir });
  try {
    await go(ui, 'site.test/page.html');
    await tabPage(app, /site\.test\/page\.html/);
    await expect(ui.locator('#address')).toHaveValue('http://site.test/page.html');
    await expect.poll(() => app.evaluate(() => globalThis.ibTest.store.getVisit('http://site.test/page.html'))).toMatchObject({ title: 'Test site', visits: 1 });
    // подсказка из истории
    await ui.click('#address');
    await ui.fill('#address', 'test site');
    const ov = await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
    await expect(ov.locator('.suggest .row')).toHaveCount(2);
    await expect(ov.locator('.suggest .row').nth(1)).toContainText('Test site');
    await ui.press('#address', 'ArrowDown');
    await expect(ov.locator('.suggest .row.sel')).toContainText('Test site');
    await ui.press('#address', 'Escape');
    expect(await app.evaluate(() => globalThis.ibTest.browser.overlayKind())).toBe(null);
    // текст с пробелом - поиск выбранным поисковиком (запрос уходит на прокси и не пускается дальше)
    // (прокси теста его не пускает - показывается страница ошибки, а в строке остаётся адрес поиска)
    const before = server.leaks.length;
    await go(ui, 'котики и собаки');
    await expect.poll(() => server.leaks.slice(before)).toContain('CONNECT duckduckgo.com:443');
    await expect.poll(async () => (await state(app)).nav.display).toBe('https://duckduckgo.com/?q=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8%20%D0%B8%20%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B8');
    const err = await tabPage(app, /^ib:\/\/newtab\/\?error=/);
    await expect(err.locator('#error')).toBeVisible();
    await expect(ui.locator('#address')).toHaveValue(/duckduckgo\.com/);
    server.leaks.length = before;
    // закладка по Ctrl+D (команда) и звезда
    await go(ui, 'site.test/two.html');
    await tabPage(app, /site\.test\/two\.html/);
    await command(app, 'bookmark');
    await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
    await expect.poll(() => app.evaluate(() => globalThis.ibTest.store.bookmarksByUrl('http://site.test/two.html').length)).toBe(1);
    await expect(ui.locator('#star')).toHaveClass(/on/);
    await expect(ui.locator('#bar .bm')).toHaveText(['Second page']);
  } finally {
    await app.close();
  }
  ({ app, ui } = await launch(server, { dir }));
  try {
    await expect(ui.locator('#bar .bm')).toHaveText(['Second page']);
    await command(app, 'history');
    const h = await tabPage(app, /^ib:\/\/history\//);
    await expect(h.locator('.li a')).toHaveText(['Second page', 'Test site']);
    await h.fill('#q', 'second');
    await expect(h.locator('.li a')).toHaveText(['Second page']);
    await h.fill('#q', 'нет-такого');
    await expect(h.locator('.empty')).toBeVisible();
    await command(app, 'bookmarks');
    const b = await tabPage(app, /^ib:\/\/bookmarks\//);
    await expect(b.locator('a', { hasText: 'Second page' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('вкладки: Ctrl+T, ссылка target=_blank, закрыть и вернуть; сайт не может открыть страницу браузера', async () => {
  const { app, ui } = await launch(server);
  try {
    await go(ui, 'site.test/page.html');
    const page = await tabPage(app, /site\.test\/page\.html/);
    await tap(page.locator('#pop'));
    await expect.poll(async () => (await tabs(app)).length).toBe(2);
    await tabPage(app, /other\.test/);
    expect((await state(app)).tabs.map((t) => t.title)).toEqual(['Test site', 'Other site']);
    // настоящее нажатие (события CDP не проходят через before-input-event)
    await app.evaluate(() => globalThis.ibTest.browser.activeWebContents().sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] }));
    await expect.poll(async () => (await tabs(app)).length).toBe(3);
    expect((await state(app)).nav.page).toBe('newtab');
    await command(app, 'closeTab');
    await expect.poll(async () => (await tabs(app)).length).toBe(2);
    await command(app, 'reopenTab');
    await expect.poll(async () => (await tabs(app)).length).toBe(3);
    await command(app, 'tab:1');
    expect((await state(app)).nav.url).toBe('http://site.test/page.html');
    // ссылка сайта на ib://settings не открывается
    await page.evaluate(() => document.getElementById('internal').click());
    await page.waitForTimeout(500);
    expect(page.url()).toBe('http://site.test/page.html');
    await page.evaluate(() => { location.href = 'ib://settings/'; });
    await page.waitForTimeout(500);
    expect(page.url()).toBe('http://site.test/page.html');
    expect(await page.evaluate(() => typeof window.ib)).toBe('undefined');
    // закрыть все - остаётся новая вкладка
    for (const t of await tabs(app)) await app.evaluate((_e, id) => globalThis.ibTest.browser.closeTab(id), t.id);
    await expect.poll(async () => (await tabs(app)).map((t) => t.url)).toEqual(['ib://newtab/']);
  } finally {
    await app.close();
  }
});

test('загрузки: файл ложится в папку «Загрузки» под своим именем, повтор не перезаписывает, список на странице', async () => {
  const { app, ui, downloads } = await launch(server);
  try {
    await go(ui, 'site.test/page.html');
    const page = await tabPage(app, /site\.test\/page\.html/);
    await tap(page.locator('#dl'));
    await expect.poll(() => fs.existsSync(path.join(downloads, 'report.bin')) && fs.statSync(path.join(downloads, 'report.bin')).size).toBe(server.FILE.length);
    await tap(page.locator('#dl'));
    await expect.poll(() => fs.existsSync(path.join(downloads, 'report (1).bin')) && fs.statSync(path.join(downloads, 'report (1).bin')).size).toBe(server.FILE.length);
    expect(fs.readFileSync(path.join(downloads, 'report.bin')).equals(server.FILE)).toBe(true);
    await command(app, 'downloads');
    const d = await tabPage(app, /^ib:\/\/downloads\//);
    await expect(d.locator('[data-dl]')).toHaveCount(2);
    await expect(d.locator('[data-state="completed"]')).toHaveCount(2);
    await expect(d.locator('#folder')).toContainText(downloads);
    // удалённый файл помечается, запись убирается из списка
    fs.rmSync(path.join(downloads, 'report.bin'));
    await d.reload();
    await expect(d.locator('[data-state="missing"]')).toHaveCount(1);
    await tap(d.locator('[data-state="missing"] [data-act="remove"]'));
    await expect(d.locator('[data-dl]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('импорт из Chrome кнопкой: закладки в папке «Из Chrome», история ищется, профиль не тронут', async () => {
  const dir = tmp('profile');
  const chrome = path.join(dir, 'chrome-user-data');
  const T = Date.UTC(2026, 9, 20, 12);
  writeUserData(chrome, {
    Default: {
      bar: [{ title: 'Хаб', url: 'https://alexalesha.github.io/', added: T }, { title: 'Работа', children: [{ title: 'Почта', url: 'https://mail.example.com/', added: T }] }],
      other: [{ title: 'Вики', url: 'https://ru.wikipedia.org/', added: T }],
      history: [{ url: 'https://news.example.org/a', title: 'Новости дня', visits: 7, lastVisit: T }, { url: 'https://hidden.example.org/', title: 'x', visits: 1, lastVisit: T, hidden: true }],
    },
  }, { Default: 'Алексей' });
  const before = fs.readFileSync(path.join(chrome, 'Default', 'History'));
  const { app, ui } = await launch(server, { dir, env: { IB_CHROME_DIR: chrome } });
  try {
    await command(app, 'settings');
    const s = await tabPage(app, /^ib:\/\/settings\//);
    await expect(s.locator('#profile option')).toHaveText(['Алексей']);
    await tap(s.locator('#import-btn'));
    await expect(s.locator('#import-result')).toHaveText('Перенесено закладок: 3, записей истории: 1');
    await tap(s.locator('#import-btn'));
    await expect(s.locator('#import-result')).toHaveText('Перенесено закладок: 0, записей истории: 1');
    await expect(ui.locator('#bar .bm')).toHaveText(['Из Chrome']);
    await ui.click('#bar .bm');
    const ov = await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
    await expect(ov.locator('.panel .row')).toHaveText(['Хаб', 'Работа', 'Другие закладки']);
    await ov.locator('.backdrop').dispatchEvent('mousedown');
    await command(app, 'history');
    const h = await tabPage(app, /^ib:\/\/history\//);
    await h.fill('#q', 'новости');
    await expect(h.locator('.li a')).toHaveText(['Новости дня']);
    expect(fs.readFileSync(path.join(chrome, 'Default', 'History')).equals(before)).toBe(true);
  } finally {
    await app.close();
  }
});

test('закон: без действий пользователя наружу не уходит ничего - ни со своих страниц, ни из интерфейса, ни за значками', async () => {
  const { app, ui } = await launch(server);
  try {
    await waitLists(app);
    server.leaks.length = 0;
    for (const name of ['settings', 'history', 'bookmarks', 'downloads']) {
      await command(app, name);
      const p = await tabPage(app, new RegExp(`^ib://${name}/`));
      await expect(p.locator('body')).toHaveAttribute('data-ready', '1');
    }
    await command(app, 'newTab');
    await go(ui, 'site.test/page.html');
    await tabPage(app, /site\.test\/page\.html/);
    await ui.click('#menu');
    await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
    await command(app, 'escape');
    await ui.click('#shield');
    await command(app, 'escape');
    await command(app, 'newTab');
    const nt = await tabPage(app, /^ib:\/\/newtab\//);
    await expect(nt.locator('.tile')).toHaveCount(5);
    await nt.waitForTimeout(3000);
    expect(server.leaks).toEqual([]);
    // все запросы - только к тестовым сайтам и спискам
    expect(server.hits.every((u) => /^http:\/\/(site|ads|tracker|other|lists)\.test\//.test(u))).toBe(true);
  } finally {
    await app.close();
  }
});

test('поиск на странице и масштаб', async () => {
  const { app, ui } = await launch(server);
  try {
    await go(ui, 'site.test/page.html');
    await tabPage(app, /site\.test\/page\.html/);
    await command(app, 'find');
    await expect(ui.locator('#findbar')).toBeVisible();
    await ui.fill('#find', 'Hello');
    await expect(ui.locator('#find-count')).toHaveText('1 из 1');
    await ui.press('#find', 'Enter');
    await expect(ui.locator('#find-count')).toHaveText('1 из 1');
    await ui.fill('#find', 'нет такого текста');
    await expect(ui.locator('#find-count')).toHaveText('Нет совпадений');
    await ui.press('#find', 'Escape');
    await expect(ui.locator('#findbar')).toBeHidden();
    await command(app, 'zoomIn');
    await expect(ui.locator('#zoom')).toHaveText('110 %');
    await command(app, 'zoomReset');
    await expect(ui.locator('#zoom')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('закон: сайт не попадает на страницы браузера ни редиректом, ни ссылкой; страница с диска не читает чужие файлы', async () => {
  const { app, ui } = await launch(server);
  try {
    await go(ui, 'site.test/page.html');
    await tabPage(app, /site\.test\/page\.html/);
    for (const to of ['ib://settings/', 'ib://newtab/?error=x&url=http://evil.test/']) {
      await go(ui, `site.test/redir?to=${encodeURIComponent(to)}`);
      await ui.waitForTimeout(800);
      const st = await state(app);
      expect(st.nav.url.startsWith('ib:'), `редирект на ${to} -> ${st.nav.url}`).toBe(false);
    }
    const dir = tmp('file');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'SECRET');
    fs.writeFileSync(path.join(dir, 'leak.html'), `<!doctype html><title>start</title><script>
      fetch('secret.txt').then((r) => r.text()).then((t) => { document.title = 'READ:' + t; }, () => { document.title = 'BLOCKED'; });
    </script>`);
    await go(ui, 'file://' + path.join(dir, 'leak.html'));
    const fileTitle = async () => ((await state(app)).tabs.find((t) => t.url.startsWith('file:')) || {}).title;
    await expect.poll(fileTitle, { timeout: 10000 }).toMatch(/^(BLOCKED|READ:)/);
    expect(await fileTitle()).toBe('BLOCKED');
  } finally {
    await app.close();
  }
});
