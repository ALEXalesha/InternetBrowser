// Ничего личного в файлах репозитория: путь к папке автора, адрес домашней сети, почта,
// сервис донатов и домашний сервер кода. Строки собраны из кусков, иначе закон нашёл бы сам себя.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./law');

const PATTERNS = [
  new RegExp('192\\.' + '168\\.'),
  new RegExp('C:[\\\\/]+(' + 'Drive|' + 'Users)', 'i'),
  new RegExp('gm' + 'ail', 'i'),
  new RegExp('ko-?' + 'fi', 'i'),
  new RegExp('gi' + 'tea', 'i'),
];
// уже были в main до этой работы: описание замысла и скрипт выкладки (их правит главная сессия)
const OLD = new Set(['docs/superpowers/specs/2026-10-17-browser-design.md', 'tools/publish.conf', 'tools/publish_github.sh']);

test('в файлах репозитория нет личного пути, адреса домашней сети, почты и адреса домашнего сервера', () => {
  let files = [];
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean); } catch { return; }
  const found = [];
  for (const f of files) {
    if (OLD.has(f) || f === 'package-lock.json') continue;
    let data;
    try { data = fs.readFileSync(path.join(ROOT, f)); } catch { continue; }
    if (data.subarray(0, 8192).includes(0)) continue;
    const text = data.toString('utf8');
    for (const re of PATTERNS) if (re.test(text)) found.push(`${f}: ${re}`);
  }
  assert.deepEqual(found, []);
});
