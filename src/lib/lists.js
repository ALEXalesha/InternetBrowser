// Файлы списков фильтров на диске: чтение (своя копия в профиле, затем копия из сборки,
// затем запасной список) и недельное обновление. Сеть приходит снаружи (fetch), чтобы
// закон проверял обновление без интернета и чтобы браузер качал списки отдельным сеансом
// без куки. Скачиваются только сами списки, ничего о пользователе не отправляется.
'use strict';

const fs = require('fs');
const path = require('path');
const { SOURCES, needsUpdate, looksLikeList } = require('../core/filters');

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readMeta(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'lists.json'), 'utf8'));
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

/** Тексты списков для движка и откуда они: 'profile', 'bundled' или 'fallback' (пустой texts). */
function loadLists({ dir, bundled, sources = SOURCES, minRules } = {}) {
  const texts = [];
  let from = 'fallback';
  for (const s of sources) {
    const own = dir ? readText(path.join(dir, `${s.id}.txt`)) : null;
    if (looksLikeList(own, minRules)) { texts.push(own); from = 'profile'; continue; }
    const shipped = bundled ? readText(path.join(bundled, `${s.id}.txt`)) : null;
    if (looksLikeList(shipped, minRules)) { texts.push(shipped); if (from === 'fallback') from = 'bundled'; }
  }
  return { texts, from, updated: dir ? Number(readMeta(dir).updated) || 0 : 0 };
}

/**
 * Скачать списки, если прошла неделя (или force). Для каждого списка пробуются адреса по
 * очереди; плохой ответ (ошибка, HTML, обрывок) не заменяет файл. Время обновления
 * записывается, только когда скачались все списки.
 */
async function updateLists({ dir, fetch, now = Date.now(), sources = SOURCES, force = false, minRules } = {}) {
  const meta = readMeta(dir);
  if (!force && !needsUpdate(Number(meta.updated), now)) return { skipped: true, updated: Number(meta.updated), results: [] };
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const s of sources) {
    let done = null;
    let error = '';
    for (const url of s.urls) {
      try {
        const res = await fetch(url);
        if (!res || !res.ok) { error = `HTTP ${res ? res.status : '?'}`; continue; }
        const text = await res.text();
        if (!looksLikeList(text, minRules)) { error = 'не список фильтров'; continue; }
        const file = path.join(dir, `${s.id}.txt`);
        fs.writeFileSync(file + '.tmp', text);
        fs.renameSync(file + '.tmp', file);
        done = url;
        break;
      } catch (e) {
        error = String(e && e.message || e);
      }
    }
    results.push(done ? { id: s.id, ok: true, url: done } : { id: s.id, ok: false, error });
  }
  const ok = results.every((r) => r.ok);
  const next = { ...meta, tried: now };
  if (ok) next.updated = now;
  fs.writeFileSync(path.join(dir, 'lists.json'), JSON.stringify(next));
  return { skipped: false, ok, updated: ok ? now : Number(meta.updated) || 0, results };
}

module.exports = { loadLists, updateLists, readMeta };
