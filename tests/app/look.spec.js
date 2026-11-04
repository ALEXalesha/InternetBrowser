// Законы вида: во всех пяти темах, в широком и узком окне текст читается (контраст WCAG),
// кнопки и плитки не налезают друг на друга, ничего не вылезает за окно.
'use strict';
const { test, expect } = require('@playwright/test');
const { start } = require('./server');
const { launch, tabPage, command } = require('./helpers');
const { audit } = require('./audit');

const THEMES = ['glass', 'formal', 'light', 'night', 'warm'];
const SIZES = [[1280, 800], [400, 720]];

let server;
test.beforeAll(async () => { server = await start(); });
test.afterAll(async () => { await server.close(); });

async function setTheme(app, ui, theme) {
  await app.evaluate((_e, th) => { globalThis.ibTest.store.setSettings({ theme: th }); globalThis.ibTest.browser.settingsChanged(); }, theme);
  await expect(ui.locator('html')).toHaveAttribute('data-theme', theme);
}

async function resize(app, ui, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s[0], s[1]), [w, h]);
  await expect.poll(() => ui.evaluate(() => innerWidth)).toBe(w);
  await ui.waitForTimeout(150);
}

for (const lang of ['ru-RU', 'en-US']) {
  test(`закон: все темы, широкое и узкое окно - читается и не налезает (${lang})`, async () => {
    const { app, ui } = await launch(server, { lang });
    try {
      await app.evaluate(() => {
        const s = globalThis.ibTest.store;
        const f = s.addFolder({ title: 'Проекты и очень длинное название папки' });
        for (let i = 0; i < 12; i++) s.addBookmark({ title: `Закладка номер ${i}`, url: `http://site.test/${i}` });
        s.addBookmark({ parent: f, title: 'Внутри', url: 'http://site.test/in' });
        for (let i = 0; i < 30; i++) s.addVisit(`http://site.test/h${i}`, `Страница истории ${i} с длинным заголовком, который не помещается в узкое окно`, Date.now() - i * 3600000);
        s.setBlocking('off.test', false);
        globalThis.ibTest.browser.bookmarksChanged();
      });
      // вкладки: 1 - настройки, 2 - история, 3 - новая вкладка
      await command(app, 'settings');
      await command(app, 'history');
      await command(app, 'newTab');
      const settings = await tabPage(app, /^ib:\/\/settings\//);
      const history = await tabPage(app, /^ib:\/\/history\//);
      const problems = [];
      for (const theme of THEMES) {
        await setTheme(app, ui, theme);
        for (const [w, h] of SIZES) {
          await resize(app, ui, w, h);
          const where = `${theme} ${w}px`;
          const add = (name, list) => problems.push(...list.map((p) => `${where} ${name}: ${p}`));
          add('полоса', await ui.evaluate(audit, { groups: ['#navbar', '#strip', '#tabs', '#bar', '#omni'], clipX: '#bar, #tabs', fit: 'button, .tab, #omni' }));
          await command(app, 'tab:3');
          const nt = await tabPage(app, /^ib:\/\/newtab\//);
          await expect(nt.locator('html')).toHaveAttribute('data-theme', theme);
          await expect.poll(() => nt.evaluate(() => innerWidth)).toBe(w);
          add('новая вкладка', await nt.evaluate(audit, { groups: ['.links', '.foot'] }));
          await command(app, 'tab:1');
          await expect(settings.locator('html')).toHaveAttribute('data-theme', theme);
          add('настройки', await settings.evaluate(audit, { groups: ['.setrow', '.seg'] }));
          await command(app, 'tab:2');
          await expect(history.locator('html')).toHaveAttribute('data-theme', theme);
          add('история', await history.evaluate(audit, { groups: ['.li', '.toolbar'] }));
          await ui.click('#menu');
          const ov = await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
          await expect(ov.locator('.panel')).toBeVisible();
          add('меню', await ov.evaluate(audit, { groups: ['.panel', '.zoomrow', '.themes'], fit: '.panel, .row' }));
          await command(app, 'escape');
          await ui.click('#shield');
          await expect(ov.locator('.panel h3')).toBeVisible();
          add('щит', await ov.evaluate(audit, { groups: ['.panel'], fit: '.panel, .row' }));
          await command(app, 'escape');
        }
      }
      expect(problems).toEqual([]);
    } finally {
      await app.close();
    }
  });
}

test('узкое окно: строка адреса не короче 120 px, кнопки на месте, вкладки сжимаются', async () => {
  const { app, ui } = await launch(server);
  try {
    for (let i = 0; i < 9; i++) await command(app, 'newTab');
    await resize(app, ui, 360, 600);
    const r = await ui.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      return { omni: box('#omni').width, menu: box('#menu').right, tabs: [...document.querySelectorAll('.tab')].map((t) => t.getBoundingClientRect().width), strip: box('#strip').width };
    });
    expect(r.omni).toBeGreaterThanOrEqual(120);
    expect(r.menu).toBeLessThanOrEqual(360);
    expect(r.tabs.length).toBe(10);
    for (const w of r.tabs) expect(w).toBeGreaterThanOrEqual(30);
    // страница вкладки начинается сразу под полосой и занимает всё остальное окно
    const b = await app.evaluate(() => {
      const t = globalThis.ibTest.browser;
      const v = t.win.contentView.children.find((c) => c.webContents === t.activeWebContents());
      return v.getBounds();
    });
    const top = await ui.evaluate(() => Math.ceil(document.getElementById('chrome').getBoundingClientRect().height));
    expect(b).toEqual({ x: 0, y: top, width: 360, height: 600 - top });
  } finally {
    await app.close();
  }
});
