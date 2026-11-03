// Строка браузера (User-Agent) как у обычного Chrome: без «Electron/..» и имени приложения.
// С ними часть сайтов (вход Google, мессенджеры, видео) считает браузер ненастоящим и
// показывает заглушку. Ничего лишнего о пользователе строка не сообщает.
'use strict';

const EXTRA = /\s+(Electron|internet-browser|InternetBrowser)\/\S+/gi;

function cleanUserAgent(ua) {
  return String(ua || '').replace(EXTRA, '').replace(/\s{2,}/g, ' ').trim();
}

module.exports = { cleanUserAgent };
