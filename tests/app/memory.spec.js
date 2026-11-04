// Законы памяти: 20 запусков подряд на одном профиле - каждый поднимается, память после
// запуска не растёт, профиль не пухнет; внутри запуска 20 открытых и закрытых вкладок не
// оставляют за собой страниц и процессов.
'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { start } = require('./server');
const { launch, tabPage, go, tabs, command, tmp } = require('./helpers');

let server;
test.beforeAll(async () => { server = await start(); });
test.afterAll(async () => { await server.close(); });

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

test('закон: 20 запусков подряд без роста памяти и без разбухания профиля', async () => {
  test.setTimeout(600000);
  const dir = tmp('profile');
  const mem = [];
  const sizes = [];
  for (let i = 0; i < 20; i++) {
    const { app, ui } = await launch(server, { dir });
    try {
      await go(ui, 'site.test/page.html');
      await tabPage(app, /site\.test\/page\.html/);
      await expect(ui.locator('.tab.active .title')).toHaveText('Test site');
      await ui.waitForTimeout(300);
      mem.push(await app.evaluate(({ app: a }) => a.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0)));
    } finally {
      await app.close();
    }
    sizes.push(['profile.sqlite', 'profile.sqlite-wal'].map((f) => { try { return fs.statSync(path.join(dir, f)).size; } catch { return 0; } }).reduce((a, b) => a + b, 0));
  }
  const first = median(mem.slice(0, 5));
  const last = median(mem.slice(-5));
  expect(mem.length).toBe(20);
  expect(last).toBeLessThanOrEqual(first * 1.25);
  expect(Math.max(...sizes)).toBeLessThan(2 * 1024 * 1024);
});

test('закон: 20 открытых и закрытых вкладок не оставляют страниц и процессов', async () => {
  const { app, ui } = await launch(server);
  try {
    await go(ui, 'site.test/page.html');
    await tabPage(app, /site\.test\/page\.html/);
    const count = () => app.evaluate(({ webContents, app: a }) => ({ wc: webContents.getAllWebContents().length, procs: a.getAppMetrics().length }));
    const before = await count();
    for (let i = 0; i < 20; i++) {
      await app.evaluate((_e, n) => globalThis.ibTest.browser.openTab(`http://other.test/?n=${n}`, { activate: true }), i);
    }
    await expect.poll(async () => (await tabs(app)).length).toBe(21);
    for (const t of (await tabs(app)).slice(1)) await app.evaluate((_e, id) => globalThis.ibTest.browser.closeTab(id), t.id);
    await expect.poll(async () => (await tabs(app)).length).toBe(1);
    await expect.poll(async () => (await count()).wc, { timeout: 15000 }).toBe(before.wc);
    await expect.poll(async () => (await count()).procs, { timeout: 15000 }).toBeLessThanOrEqual(before.procs + 1);
    await command(app, 'reopenTab');
    await expect.poll(async () => (await tabs(app)).length).toBe(2);
  } finally {
    await app.close();
  }
});
