// Блокировка рекламы и трекеров: решение по каждому запросу вкладки и счётчик по вкладке.
// Движок фильтров - @ghostery/adblocker (EasyList, EasyPrivacy). Свои правила поверх него:
//  - документ вкладки (сама страница) не режется никогда: обычные сайты всегда открываются;
//  - на выключенном сайте (выключатель «на этом сайте») не режется ничего, и косметики нет;
//  - режутся только http(s) и ws(s) запросы, у которых известна страница вкладки;
//  - страница вкладки ведётся здесь, а не по адресу вкладки в Electron: запрос документа
//    (mainFrame) заводит «ожидаемую» страницу, committed() делает её текущей, aborted()
//    отбрасывает (загрузка файла, ошибка). Первые подресурсы новой страницы приходят раньше,
//    чем Electron обновит адрес вкладки, - они судятся по ожидаемой; подресурс, чей referrer
//    с сайта текущей страницы, - по текущей (переход ещё не случился или не случится).
'use strict';

const { Request } = require('@ghostery/adblocker');
const { siteOf } = require('./sites');

const WEB = /^(https?|wss?):/i;
const KEEP_RECENT = 50;

/**
 * engine   - FiltersEngine (можно заменить позже через setEngine, когда обновятся списки)
 * isSiteOn - (site) => включена ли блокировка на сайте
 * enabled  - () => включена ли блокировка вообще
 * cosmetic - () => скрывать ли рекламные места на странице
 */
function createBlocker({ engine, isSiteOn = () => true, enabled = () => true, cosmetic = () => true } = {}) {
  let eng = engine;
  const tabs = new Map();
  let total = 0;

  function tab(tabId) {
    let t = tabs.get(tabId);
    if (!t) { t = { count: 0, recent: [], top: null, pending: null }; tabs.set(tabId, t); }
    return t;
  }

  /** Вкладка сразу на странице url, счётчик с нуля. */
  function resetTab(tabId, url) {
    tabs.set(tabId, { count: 0, recent: [], top: url, pending: null });
  }

  /**
   * Вкладка показала документ url: ожидаемая страница (со своим счётом) становится текущей.
   * Без ожидаемой (страница из кэша «назад») - новая текущая страница со счётом с нуля.
   */
  function committed(tabId, url) {
    const t = tab(tabId);
    if (t.pending) {
      tabs.set(tabId, { count: t.pending.count, recent: t.pending.recent, top: url, pending: null });
    } else if (t.top !== url) {
      tabs.set(tabId, { count: 0, recent: [], top: url, pending: null });
    }
  }

  /** Переход не состоялся (загрузка вместо страницы, ошибка): остаётся прежняя страница. */
  function aborted(tabId) {
    const t = tabs.get(tabId);
    if (t) t.pending = null;
  }

  function hostOf(u) {
    try { return new URL(u).hostname; } catch { return ''; }
  }

  /** Какой странице вкладки принадлежит подресурс: ожидаемой или текущей. */
  function pageFor(t, referrer) {
    if (!t.pending) return t;
    const ref = hostOf(referrer);
    if (ref && t.top && ref === hostOf(t.top) && ref !== hostOf(t.pending.top)) return t;
    return t.pending;
  }

  /**
   * Решение по запросу { url, type, tabId, topUrl }. type - resourceType Electron
   * (mainFrame, subFrame, script, image, xhr...). Возвращает { cancel, filter? }.
   */
  function decide({ url, type, tabId, topUrl, referrer }) {
    if (type === 'mainFrame') {
      if (tabId != null) tab(tabId).pending = { count: 0, recent: [], top: url };
      return { cancel: false };
    }
    const page = tabId != null ? pageFor(tab(tabId), referrer) : null;
    const res = judge(url, type, page && page.top ? page.top : topUrl);
    if (!res.cancel) return res;
    if (page) {
      page.count++;
      page.recent.unshift(url);
      if (page.recent.length > KEEP_RECENT) page.recent.length = KEEP_RECENT;
    }
    total++;
    return res;
  }

  /** Решение без счёта и памяти вкладки: срезал бы блокировщик этот запрос со страницы topUrl. */
  function judge(url, type, topUrl) {
    if (!eng || !enabled() || !WEB.test(String(url))) return { cancel: false };
    const site = siteOf(topUrl);
    if (!site || !isSiteOn(site)) return { cancel: false };
    let res;
    try {
      res = eng.match(Request.fromRawDetails({ url, sourceUrl: topUrl, type: type || 'other' }));
    } catch {
      return { cancel: false };
    }
    if (!res.match) return { cancel: false };
    return { cancel: true, filter: res.filter ? res.filter.toString() : '' };
  }

  function stats(tabId) {
    const t = tabs.get(tabId);
    return t ? { count: t.count, recent: t.recent.slice() } : { count: 0, recent: [] };
  }

  function forgetTab(tabId) {
    tabs.delete(tabId);
  }

  /**
   * CSS, скрывающий рекламные места на странице. classes/ids/hrefs - то, что нашлось
   * на странице (для общих правил вида ##.ad). На выключенном сайте - пусто.
   */
  function cosmeticsFor(url, { classes = [], ids = [], hrefs = [] } = {}) {
    if (!eng || !enabled() || !cosmetic()) return '';
    const site = siteOf(url);
    if (!site || !isSiteOn(site)) return '';
    let hostname;
    try { hostname = new URL(url).hostname; } catch { return ''; }
    try {
      const { styles } = eng.getCosmeticsFilters({ url, hostname, domain: site, classes, ids, hrefs, getRulesFromDOM: true, getRulesFromHostname: true, getBaseRules: true });
      return styles || '';
    } catch {
      return '';
    }
  }

  return {
    decide, judge, resetTab, committed, aborted, stats, forgetTab, cosmeticsFor,
    setEngine(e) { eng = e; },
    total: () => total,
  };
}

module.exports = { createBlocker };
