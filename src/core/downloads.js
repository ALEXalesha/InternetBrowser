// Загрузки: безопасное имя файла в папке «Загрузки» без перезаписи чужих файлов,
// доля готовности и размер для списка.
'use strict';

const path = require('path');

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_NAME = 180;

/**
 * Имя от сайта может быть любым: с путём, двоеточием, именем устройства Windows, точкой в
 * конце. Здесь оно становится обычным именем файла: без разделителей и запретных знаков,
 * не длиннее MAX_NAME символов, с сохранённым расширением.
 */
function safeName(raw) {
  let name = String(raw == null ? '' : raw).toWellFormed();
  name = name.split(/[\\/]/).pop();
  // Символы смены направления и невидимые: «invoice\u202efdp.exe» выглядел бы как «invoiceexe.pdf».
  name = name.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, '');
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  if (!name) name = 'download';
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot) : '';
  // Windows не даст создать «CON.tar.gz»: имя устройства проверяется до первой точки.
  if (RESERVED.test(base.split('.')[0])) base = '_' + base;
  if (ext.length > 20) { base += ext; ext = ''; }
  const chars = [...base];
  if (chars.length + [...ext].length > MAX_NAME) base = chars.slice(0, MAX_NAME - [...ext].length).join('').replace(/[\s.]+$/, '') || '_';
  return base + ext;
}

/** Свободное имя в папке: «файл.zip», «файл (1).zip», «файл (2).zip»... taken(name) - занято ли. */
function uniqueName(raw, taken) {
  const name = safeName(raw);
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 100000; i++) {
    const n = `${base} (${i})${ext}`;
    if (!taken(n)) return n;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** Полный путь в папке загрузок; имя всегда остаётся внутри папки. */
function targetPath(dir, raw, taken) {
  return path.join(dir, uniqueName(raw, (n) => taken(path.join(dir, n))));
}

function progress(received, total) {
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(1, received / total));
}

function formatBytes(n, lang = 'ru') {
  const units = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, Number(n) || 0);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(v < 10 ? 1 : 0);
  return `${lang === 'ru' ? s.replace('.', ',') : s} ${units[i]}`;
}

module.exports = { safeName, uniqueName, targetPath, progress, formatBytes, MAX_NAME };
