// Снимки окна для README (docs/screens). Браузер работает с невидимым окном и локальным
// сервером-прокси законов (в сеть не ходит); полоса вкладок, страница и всплывающая панель
// снимаются по отдельности и складываются в одну картинку.
//   xvfb-run -a node tools/screenshots.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../tests/app/server');
const { launch, tabPage, go, command } = require('../tests/app/helpers');

const OUT = path.join(__dirname, '..', 'docs', 'screens');

async function shot(app, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-shot-'));
  const png = await app.evaluate(async ({ BrowserWindow }, tmp) => {
    const fsx = process.mainModule.require('fs');
    const px = process.mainModule.require('path');
    const w = BrowserWindow.getAllWindows()[0];
    const [cw, ch] = w.getContentSize();
    const parts = [{ img: await w.webContents.capturePage(), x: 0, y: 0 }];
    for (const v of w.contentView.children) {
      const b = v.getBounds();
      parts.push({ img: await v.webContents.capturePage(), x: b.x, y: b.y });
    }
    const imgs = parts.map((p, i) => { const f = px.join(tmp, `p${i}.png`); fsx.writeFileSync(f, p.img.toPNG()); return `<img src="p${i}.png" style="position:absolute;left:${p.x}px;top:${p.y}px">`; });
    fsx.writeFileSync(px.join(tmp, 'c.html'), `<body style="margin:0;width:${cw}px;height:${ch}px;position:relative;overflow:hidden;background:#000">${imgs.join('')}</body>`);
    const c = new BrowserWindow({ show: false, width: cw, height: ch, useContentSize: true, webPreferences: { offscreen: true } });
    await c.loadFile(px.join(tmp, 'c.html'));
    await new Promise((r) => setTimeout(r, 400));
    const out = await c.webContents.capturePage({ x: 0, y: 0, width: cw, height: ch });
    c.destroy();
    return out.toPNG().toString('base64');
  }, dir);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, 'base64'));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`docs/screens/${name}.png`);
}

async function theme(app, ui, id) {
  await app.evaluate((_e, th) => { globalThis.ibTest.store.setSettings({ theme: th }); globalThis.ibTest.browser.settingsChanged(); }, id);
  await ui.waitForFunction((th) => document.documentElement.dataset.theme === th, id);
  await ui.waitForTimeout(400);
}

async function size(app, ui, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s[0], s[1]), [w, h]);
  await ui.waitForFunction((x) => innerWidth === x, w);
  await ui.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await start();
  const { app, ui } = await launch(server, { lang: 'ru-RU' });
  try {
    await app.evaluate(() => {
      const s = globalThis.ibTest.store;
      for (const [t, u] of [['Хаб', 'https://alexalesha.github.io/'], ['GitHub', 'https://github.com/ALEXalesha'], ['Википедия', 'https://ru.wikipedia.org/']]) s.addBookmark({ title: t, url: u });
      const f = s.addFolder({ title: 'Проекты' });
      s.addBookmark({ parent: f, title: 'Rail Runner', url: 'https://alexalesha.github.io/RailRunner/' });
      const now = Date.now();
      const items = [
        ['https://ru.wikipedia.org/wiki/Стекло', 'Стекло - Википедия'], ['https://github.com/ALEXalesha/LiquidGlass', 'ALEXalesha/LiquidGlass: стекло iOS 26 на вебе'],
        ['https://developer.mozilla.org/docs/Web/CSS/backdrop-filter', 'backdrop-filter - CSS | MDN'], ['https://www.electronjs.org/docs/latest/api/web-contents-view', 'WebContentsView | Electron'],
        ['https://easylist.to/', 'EasyList - Overview'], ['https://alexalesha.github.io/', 'Хаб'], ['https://news.ycombinator.com/', 'Hacker News'],
        ['https://ru.wikipedia.org/wiki/Жидкий_кристалл', 'Жидкий кристалл - Википедия'], ['https://github.com/ghostery/adblocker', 'ghostery/adblocker: Efficient adblocker library'],
      ];
      items.forEach(([u, t], i) => s.addVisit(u, t, now - i * 47 * 60000));
      globalThis.ibTest.browser.bookmarksChanged();
    });
    await go(ui, 'news.test/article.html');
    await tabPage(app, /news\.test/);
    await command(app, 'settings');
    await command(app, 'newTab');
    const nt = await tabPage(app, /^ib:\/\/newtab\//);
    await nt.waitForSelector('body[data-ready="1"]');
    await ui.waitForTimeout(800);
    await shot(app, 'newtab');

    await command(app, 'tab:1');
    await ui.waitForTimeout(500);
    await ui.click('#shield');
    await tabPage(app, /^ib:\/\/ui\/overlay\.html/);
    await ui.waitForTimeout(600);
    await shot(app, 'shield');
    await command(app, 'escape');

    await theme(app, ui, 'light');
    await command(app, 'tab:2');
    await ui.waitForTimeout(600);
    await shot(app, 'settings-light');

    await theme(app, ui, 'warm');
    await command(app, 'history');
    const h = await tabPage(app, /^ib:\/\/history\//);
    await h.waitForSelector('body[data-ready="1"]');
    await h.fill('#q', 'стекло');
    await h.waitForFunction(() => document.querySelectorAll('.li').length === 3);
    await h.waitForTimeout(400);
    await shot(app, 'history-warm');

    await theme(app, ui, 'night');
    await command(app, 'tab:1');
    await size(app, ui, 420, 760);
    await shot(app, 'narrow-night');
  } finally {
    await app.close();
    await server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
