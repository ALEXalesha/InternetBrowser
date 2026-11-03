// Списки фильтров: откуда брать, когда обновлять, как отличить настоящий список от
// страницы ошибки, и маленький запасной список на случай, если настоящих ещё нет.
'use strict';

const { FiltersEngine } = require('@ghostery/adblocker');

const WEEK = 7 * 24 * 3600 * 1000;

// Официальный адрес и запасной - зеркало того же репозитория на GitHub.
const SOURCES = [
  { id: 'easylist', name: 'EasyList', urls: ['https://easylist.to/easylist/easylist.txt', 'https://raw.githubusercontent.com/easylist/easylist/gh-pages/easylist.txt'] },
  { id: 'easyprivacy', name: 'EasyPrivacy', urls: ['https://easylist.to/easylist/easyprivacy.txt', 'https://raw.githubusercontent.com/easylist/easylist/gh-pages/easyprivacy.txt'] },
];

// Запасной список: самые известные рекламные сети и счётчики. Работает, пока не скачаны полные.
const FALLBACK = `[Adblock Plus 2.0]
! Title: InternetBrowser fallback
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||adservice.google.com^
||google-analytics.com^
||googletagservices.com^
||adnxs.com^
||criteo.com^
||criteo.net^
||taboola.com^
||outbrain.com^
||scorecardresearch.com^
||quantserve.com^
||hotjar.com^
||mc.yandex.ru^
||an.yandex.ru^
||yandexadexchange.net^
||ads.yahoo.com^
||amazon-adsystem.com^
||adsrvr.org^
||pubmatic.com^
||rubiconproject.com^
||openx.net^
||moatads.com^
||top-fwz1.mail.ru^
||ad.mail.ru^
##.adsbygoogle
##ins.adsbygoogle
##.ad-banner
##.advertisement
##[id^="div-gpt-ad"]
`;

/** Пора ли обновлять: прошла неделя, обновления не было, или часы ушли назад. */
function needsUpdate(last, now) {
  if (!Number.isFinite(last) || last <= 0) return true;
  if (last > now) return true;
  return now - last >= WEEK;
}

/**
 * Похоже ли на список фильтров: заголовок [Adblock ...] или «! Title:», не HTML и
 * хотя бы minRules правил. Страница ошибки или обрывок не заменят рабочий список.
 */
function looksLikeList(text, minRules = 100) {
  if (typeof text !== 'string') return false;
  const head = text.slice(0, 2000);
  if (/<html|<!doctype/i.test(head)) return false;
  if (!/^\s*\[Adblock[^\]]*\]|^! Title:/im.test(head)) return false;
  let rules = 0;
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l && !l.startsWith('!') && !l.startsWith('[')) rules++;
    if (rules >= minRules) return true;
  }
  return false;
}

function buildEngine(texts) {
  const all = (texts || []).filter((t) => typeof t === 'string' && t);
  return FiltersEngine.parse((all.length ? all : [FALLBACK]).join('\n'), {
    loadCosmeticFilters: true,
    loadNetworkFilters: true,
    loadGenericCosmeticsFilters: true,
    enableHtmlFiltering: false,
  });
}

module.exports = { WEEK, SOURCES, FALLBACK, needsUpdate, looksLikeList, buildEngine };
