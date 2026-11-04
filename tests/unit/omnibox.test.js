// Законы адресной строки: адрес или поиск.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { src, forAll } = require('./law');

const { parseInput, forDisplay, suggest } = src('core/omnibox');
const { searchUrl, queryFromUrl, ENGINES, engine } = src('core/search');
const { TLDS, isKnownTld } = src('core/tlds');
const pages = src('core/pages');

const ALLOWED = new Set(['http:', 'https:', 'file:', 'ib:', 'about:']);
const TLD_LIST = [...TLDS];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const LABEL_CHARS = LETTERS + '0123456789-';
const ANY = LETTERS + 'ABCXYZ0123456789 .:/?#&=%+-_@!*()[]\\\'"<>~абвгдеёжзийклмнопрстуфхцчшщъыьэюя€😀\t';

function label(r) {
  const core = r.str(LABEL_CHARS, 0, 12);
  return r.pick(LETTERS) + core.replace(/-+$/, '') + (core ? r.pick(LETTERS) : '');
}

function genHost(r) {
  const n = r.int(1, 3);
  const labels = Array.from({ length: n }, () => label(r));
  return `${labels.join('.')}.${r.pick(TLD_LIST)}`;
}

function genPath(r) {
  if (r.bool(0.4)) return '';
  return '/' + r.str(LETTERS + '0123456789/-_.', 0, 20) + (r.bool(0.3) ? '?q=' + r.str(LETTERS, 1, 6) : '') + (r.bool(0.2) ? '#' + r.str(LETTERS, 1, 5) : '');
}

test('закон: любой ввод даёт пусто, допустимый адрес или поиск выбранным поисковиком', () => {
  forAll('omnibox-any', (r) => ({ text: r.str(ANY, 0, 40), engine: r.pick(ENGINES).id }), ({ text, engine: eid }) => {
    const res = parseInput(text, eid);
    if (res.kind === 'empty') { assert.equal(text.trim().replace(/^\?\s*$/, ''), ''); return; }
    const u = new URL(res.url);
    assert.ok(ALLOWED.has(u.protocol), `протокол ${u.protocol}`);
    if (res.kind === 'search') assert.equal(new URL(res.url).origin, new URL(engine(eid).base).origin);
  }, 2000);
});

test('закон: поиск раскодируется обратно ровно в набранный текст', () => {
  forAll('omnibox-search-roundtrip', (r) => ({ text: r.str(ANY, 1, 40) + ' ' + r.str(ANY, 1, 10), engine: r.pick(ENGINES).id }), ({ text, engine: eid }) => {
    const res = parseInput(text, eid);
    if (res.kind !== 'search') return;
    assert.equal(queryFromUrl(res.url), res.query);
    const trimmed = text.toWellFormed().trim();
    assert.equal(res.query, trimmed.startsWith('?') ? trimmed.slice(1).trim() : trimmed);
  }, 1500);
});

test('закон: текст с пробелом внутри и без схемы - всегда поиск', () => {
  forAll('omnibox-space', (r) => {
    const a = r.bool() ? genHost(r) + (r.bool() ? '/' + r.str(LETTERS, 1, 8) : '') : r.str(LETTERS + '.:/', 1, 15);
    return `${a}${r.pick([' ', '  ', '\t'])}${r.str(LETTERS + '.', 1, 10)}`;
  }, (text) => {
    assert.equal(parseInput(text).kind, 'search');
  });
});

test('закон: домен с известным окончанием (с портом и путём) - адрес с тем же хостом', () => {
  forAll('omnibox-domain', (r) => {
    const host = genHost(r);
    const port = r.bool(0.2) ? ':' + r.int(1, 65535) : '';
    return { host, text: host + port + genPath(r), port };
  }, ({ host, text, port }) => {
    const res = parseInput(text);
    assert.equal(res.kind, 'url');
    const u = new URL(res.url);
    assert.equal(u.hostname, new URL('http://' + host).hostname);
    const tld = host.split('.').pop();
    assert.equal(u.protocol, ['local', 'test', 'lan', 'home', 'internal', 'onion', 'example', 'invalid', 'localhost'].includes(tld) ? 'http:' : 'https:');
    const def = u.protocol === 'https:' ? ':443' : ':80';
    assert.equal(u.port ? ':' + u.port : '', port === def ? '' : port);
  });
});

test('закон: IPv4 и localhost - адрес по http, неверный IPv4 - поиск', () => {
  forAll('omnibox-ip', (r) => {
    const parts = Array.from({ length: 4 }, () => r.int(0, 300));
    return { parts, path: genPath(r), port: r.bool(0.4) ? r.int(1, 65535) : 0 };
  }, ({ parts, path, port }) => {
    const text = parts.join('.') + (port ? ':' + port : '') + path;
    const res = parseInput(text);
    if (parts.every((p) => p <= 255)) {
      assert.equal(res.kind, 'url');
      assert.equal(new URL(res.url).protocol, 'http:');
    } else {
      assert.equal(res.kind, 'search');
    }
  });
  assert.equal(parseInput('localhost:3000/a').url, 'http://localhost:3000/a');
  assert.equal(parseInput('localhost').url, 'http://localhost/');
  assert.equal(parseInput('[::1]:8080').url, 'http://[::1]:8080/');
});

test('закон: разбор идемпотентен - открытый адрес, набранный снова, открывается тот же', () => {
  const SPECIAL = ['ib://history', 'ib://settings/#about', 'IB://NewTab', 'about:blank', 'file:///C:/a b.html', 'C:\\x\\y.pdf', 'localhost:8080/x', '[::1]/a', '127.0.0.1:3000'];
  forAll('omnibox-idempotent', (r) => r.pick([genHost(r) + genPath(r), r.str(ANY, 1, 30), r.pick(SPECIAL), `https://${genHost(r)}${genPath(r)}`]), (text) => {
    const res = parseInput(text);
    if (res.kind !== 'url') return;
    const again = parseInput(res.url);
    assert.equal(again.kind, 'url');
    assert.equal(again.url, res.url);
  }, 1500);
});

test('закон: javascript:, data: и другие опасные схемы не открываются - только поиск', () => {
  const schemes = ['javascript', 'JavaScript', 'vbscript', 'data', 'blob', 'chrome', 'view-source', 'file ', 'mailto', 'ftp', 'ws'];
  forAll('omnibox-danger', (r) => `${r.pick(schemes)}:${r.str(ANY, 0, 30)}`, (text) => {
    const res = parseInput(text);
    if (res.kind === 'empty') return;
    assert.equal(res.kind, 'search', text);
    assert.equal(new URL(res.url).protocol, 'https:');
  });
});

test('закон: адрес без схемы никогда не несёт логин (user@host)', () => {
  forAll('omnibox-userinfo', (r) => `${r.str(LETTERS, 1, 8)}${r.bool() ? ':' + r.str(LETTERS, 1, 5) : ''}@${genHost(r)}${genPath(r)}`, (text) => {
    const res = parseInput(text);
    assert.equal(res.kind, 'search');
  });
});

test('примеры адресной строки', () => {
  assert.deepEqual(parseInput('   '), { kind: 'empty' });
  assert.deepEqual(parseInput('?'), { kind: 'empty' });
  assert.equal(parseInput('?github.com').kind, 'search');
  assert.equal(parseInput('github.com').url, 'https://github.com/');
  assert.equal(parseInput('GitHub.COM/ALEXalesha').url, 'https://github.com/ALEXalesha');
  assert.equal(parseInput('http://example.com').url, 'http://example.com/');
  assert.equal(parseInput('https://').kind, 'search');
  assert.equal(parseInput('http:example.com').kind, 'search');
  assert.equal(parseInput('пример.рф').url, 'https://xn--e1afmkfd.xn--p1ai/');
  assert.equal(parseInput('node.js').kind, 'search');
  assert.equal(parseInput('router').kind, 'search');
  assert.equal(parseInput('nas.local:5000').url, 'http://nas.local:5000/');
  assert.equal(parseInput('example.com:0').kind, 'search');
  assert.equal(parseInput('example.com:99999').kind, 'search');
  assert.equal(parseInput('a..com').kind, 'search');
  assert.equal(parseInput('-a.com').kind, 'search');
  assert.equal(parseInput('a.123').kind, 'search');
  assert.equal(parseInput('example.com.').url, 'https://example.com./');
  assert.equal(parseInput('a\\b.com').kind, 'search');
  assert.equal(parseInput('[zz]').kind, 'search');
  assert.equal(parseInput(':80').kind, 'search');
  assert.equal(parseInput('file:///C:/x/index.html').url, 'file:///C:/x/index.html');
  assert.equal(parseInput('file:x').kind, 'search');
  assert.equal(parseInput('C:\\Temp\\a.html').url, 'file:///C:/Temp/a.html');
  assert.equal(parseInput('about:blank').url, 'about:blank');
  assert.equal(parseInput('about:config').kind, 'search');
  assert.equal(parseInput('ib://history').url, 'ib://history/');
  assert.equal(parseInput('ib://nope').kind, 'search');
  assert.equal(parseInput(null).kind, 'empty');
  assert.equal(parseInput('котики', 'yandex').url, 'https://yandex.ru/search/?text=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8');
  assert.equal(parseInput('a b', 'нет такого').url, searchUrl('duckduckgo', 'a b'));
});

test('поисковики: адрес запроса и обратно, чужой адрес - не запрос', () => {
  for (const e of ENGINES) assert.equal(queryFromUrl(searchUrl(e.id, 'a+b & c')), 'a+b & c');
  assert.equal(queryFromUrl('https://example.com/?q=1'), null);
  assert.equal(queryFromUrl('не адрес'), null);
  assert.equal(engine('нет').id, 'duckduckgo');
  assert.ok(isKnownTld('RU') && isKnownTld('рф') && !isKnownTld('js'));
});

test('внутренние страницы: имя и канонический вид', () => {
  assert.equal(pages.pageName('ib://Settings/#lang'), 'settings');
  assert.equal(pages.pageName('ib://x/'), null);
  assert.equal(pages.pageName(undefined), null);
  assert.equal(pages.canonical('ib://newtab?x=1'), 'ib://newtab/?x=1');
  assert.equal(pages.canonical('https://a.com'), null);
});

test('строка не в фокусе: у новой вкладки пусто, кириллица читается', () => {
  assert.equal(forDisplay(pages.NEWTAB), '');
  assert.equal(forDisplay('about:blank'), '');
  assert.equal(forDisplay(''), '');
  assert.equal(forDisplay('https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%82'), 'https://ru.wikipedia.org/wiki/Кот');
  assert.equal(forDisplay('https://a.com/%E0%A4%A'), 'https://a.com/%E0%A4%A');
});

const NOW = Date.UTC(2026, 10, 1);
function genEntries(r) {
  return Array.from({ length: r.int(0, 30) }, () => ({
    url: `https://${r.pick(['a', 'b', 'git', 'news'])}${r.pick(['hub', 'lab', ''])}.${r.pick(['com', 'ru'])}/${r.str(LETTERS, 0, 4)}`,
    title: r.str(LETTERS + ' ', 0, 12),
    visits: r.int(0, 50),
    lastVisit: NOW - r.int(0, 90) * 86400000,
    bookmarked: r.bool(0.2),
  }));
}

test('закон: подсказки содержат все слова ввода, без повторов, по убыванию очков, не больше предела', () => {
  forAll('suggest', (r) => ({ entries: genEntries(r), input: r.pick(['', 'g', 'git hub', 'a', 'com', 'news r', 'zzz', 'H']), limit: r.int(1, 10) }), ({ entries, input, limit }) => {
    const out = suggest(input, entries, NOW, limit);
    const words = input.toLowerCase().split(/\s+/).filter(Boolean);
    assert.ok(out.length <= limit);
    assert.equal(new Set(out.map((s) => s.url)).size, out.length);
    for (const s of out) assert.ok(words.every((w) => `${s.url} ${s.title}`.toLowerCase().includes(w)));
    for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score);
    const matching = new Set(entries.filter((e) => words.length && words.every((w) => `${e.url} ${e.title}`.toLowerCase().includes(w))).map((e) => e.url));
    assert.equal(out.length, Math.min(limit, matching.size));
  });
});

test('закон: закладка выше такой же записи без закладки', () => {
  forAll('suggest-bookmark', (r) => ({ visits: r.int(0, 100), age: r.int(0, 60) }), ({ visits, age }) => {
    const base = { title: 'Docs', visits, lastVisit: NOW - age * 86400000 };
    const out = suggest('docs', [{ ...base, url: 'https://x.com/a' }, { ...base, url: 'https://x.com/b', bookmarked: true }], NOW);
    assert.equal(out[0].url, 'https://x.com/b');
  });
  assert.deepEqual(suggest('a', null), []);
  assert.deepEqual(suggest('a', [null, { title: 'a' }]), []);
  const out = suggest('ex', [{ url: 'about:blank', title: 'ex' }, { url: 'https://ex.com/' }, { url: 'https://ex.com/', title: 'ex', visits: 9, lastVisit: NOW }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://ex.com/');
});

test('закон: адрес, показанный в строке, открывается ровно тем же адресом; в нём нет символов смены направления', () => {
  const PIECES = ['%25', '%20', '%2F', '%3F', '%23', '%D0%BA%D0%BE%D1%82', '%E2%80%AE', '%E2%80%8F', '%E2%81%A6', '%C2%A0', '%00', '%7F', 'a', '-', '%E0%A4%A', '%41', '%2525', '+', '%F0%9F%98%80'];
  forAll('display-roundtrip', (r) => `https://${genHost(r)}/${Array.from({ length: r.int(0, 6) }, () => r.pick(PIECES)).join('')}${r.bool(0.3) ? '?q=' + r.pick(PIECES) : ''}`, (raw) => {
    const url = new URL(raw).href;
    const shown = forDisplay(url);
    assert.doesNotMatch(shown, /[‎‏‪-‮⁦-⁩\u0000-\u001f\u007f]/u);
    const res = parseInput(shown);
    assert.equal(res.kind, 'url', shown);
    assert.equal(res.url, url, shown);
  }, 1500);
});
