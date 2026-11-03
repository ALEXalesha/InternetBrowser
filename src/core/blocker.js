// Блокировка рекламы и трекеров: решение по каждому запросу вкладки и счётчик по вкладке.
// Движок фильтров - @ghostery/adblocker (EasyList, EasyPrivacy). Свои правила поверх него:
//  - документ вкладки (сама страница) не режется никогда: обычные сайты всегда открываются;
//  - на выключенном сайте (выключатель «на этом сайте») не режется ничего, и косметики нет;
//  - режутся только http(s) и ws(s) запросы, у которых известна страница вкладки.
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
    if (!t) { t = { count: 0, recent: [], site: null }; tabs.set(tabId, t); }
    return t;
  }

  /** Начата новая страница во вкладке: счётчик с нуля. */
  function resetTab(tabId, url) {
    tabs.set(tabId, { count: 0, recent: [], site: siteOf(url) });
  }

  /**
   * Решение по запросу { url, type, tabId, topUrl }. type - resourceType Electron
   * (mainFrame, subFrame, script, image, xhr...). Возвращает { cancel, filter? }.
   */
  function decide({ url, type, tabId, topUrl }) {
    if (type === 'mainFrame') {
      if (tabId != null) resetTab(tabId, url);
      return { cancel: false };
    }
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
    if (tabId != null) {
      const t = tab(tabId);
      t.count++;
      t.recent.unshift(url);
      if (t.recent.length > KEEP_RECENT) t.recent.length = KEEP_RECENT;
    }
    total++;
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
    decide, resetTab, stats, forgetTab, cosmeticsFor,
    setEngine(e) { eng = e; },
    total: () => total,
  };
}

module.exports = { createBlocker };
