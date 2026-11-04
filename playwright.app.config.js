// Законы окна на настоящем Electron. IB_TEST=1: окно не показывается и не берёт фокус.
// Один исполнитель: одно приложение за раз. Интернет не нужен - свой сервер-прокси.
const os = require('os');
const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/app',
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  retries: 0,
  // Клик Playwright ждёт кадр анимации; в невидимом окне вид вкладки иногда кадров не даёт.
  // Действие без срока висело бы до конца закона - пусть падает быстро и с причиной.
  use: { actionTimeout: 15000 },
  reporter: [['list']],
  outputDir: path.join(os.tmpdir(), 'internet-browser-playwright'),
});
