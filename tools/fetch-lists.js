// Скачать EasyList и EasyPrivacy в filters/ - они войдут в установщик, и браузер с первого
// запуска будет блокировать по полным спискам (дальше он сам обновляет их раз в неделю).
// В git списки не кладутся: их лицензия (GPLv3 / CC BY-SA) своя, и они меняются каждый день.
//   node tools/fetch-lists.js
'use strict';
const fs = require('fs');
const path = require('path');
const { SOURCES, looksLikeList } = require('../src/core/filters');

(async () => {
  const dir = path.join(__dirname, '..', 'filters');
  fs.mkdirSync(dir, { recursive: true });
  let bad = 0;
  for (const s of SOURCES) {
    let done = false;
    for (const url of s.urls) {
      try {
        const res = await fetch(url);
        const text = res.ok ? await res.text() : '';
        if (!looksLikeList(text)) { console.log(`${s.id}: ${url} - не список (${res.status})`); continue; }
        fs.writeFileSync(path.join(dir, `${s.id}.txt`), text);
        console.log(`${s.id}: ${url} - ${Math.round(text.length / 1024)} КБ`);
        done = true;
        break;
      } catch (e) {
        console.log(`${s.id}: ${url} - ${e.message}`);
      }
    }
    if (!done) bad++;
  }
  fs.writeFileSync(path.join(dir, 'LICENSE.txt'), 'EasyList and EasyPrivacy (https://easylist.to/) are dual licensed under GPLv3 and CC BY-SA 3.0. They are shipped unmodified as data.\n');
  process.exit(bad ? 1 : 0);
})();
