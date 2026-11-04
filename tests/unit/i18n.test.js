// Законы строк интерфейса: русский и английский полны и согласованы.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { src, ROOT } = require('./law');

const i18n = src('core/i18n');
const { THEMES } = src('core/themes');
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('закон: у каждой строки есть перевод, подстановки {x} одни и те же, пустых нет', () => {
  const ru = i18n.STRINGS.ru;
  const en = i18n.STRINGS.en;
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  for (const k of Object.keys(ru)) {
    assert.ok(ru[k].trim() && en[k].trim(), k);
    assert.deepEqual(vars(ru[k]), vars(en[k]), k);
  }
  assert.equal(ru.themeNames.split('|').length, THEMES.length);
  assert.equal(en.themeNames.split('|').length, THEMES.length);
});

test('закон: все ключи, которые зовут интерфейс и страницы, есть в строках', () => {
  const dirs = ['src/ui', 'src/pages', 'src/main'].map((d) => path.join(ROOT, d));
  const used = new Set();
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      const text = fs.readFileSync(path.join(d, f), 'utf8');
      for (const m of text.matchAll(/data-(?:t|ph|tip)="(\w+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
    }
  }
  const missing = [...used].filter((k) => !(k in i18n.STRINGS.ru));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 60);
});

test('перевод: подстановка, неизвестный ключ, таблица, язык', () => {
  assert.equal(i18n.t('ru', 'findCount', { i: 2, n: 5 }), '2 из 5');
  assert.equal(i18n.t('en', 'findCount', { i: 2 }), '2 of {n}');
  assert.equal(i18n.t('de', 'newTab'), 'Новая вкладка');
  assert.equal(i18n.t('en', 'нет-ключа'), 'нет-ключа');
  assert.equal(i18n.t('en', 'newTab'), 'New tab');
  assert.equal(i18n.table('en').newTab, 'New tab');
  assert.equal(i18n.lang('en'), 'en');
  const box = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'core', 'i18n.js'), 'utf8'), box);
  assert.equal(box.self.IBI18n.t('ru', 'newTab'), 'Новая вкладка');
});
