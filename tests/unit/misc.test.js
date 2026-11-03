// Законы загрузок, вкладок, горячих клавиш и строки браузера.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { src, forAll } = require('./law');

const dl = src('core/downloads');
const { createTabs, MAX_CLOSED } = src('core/tabs');
const { actionFor } = src('core/keys');
const { cleanUserAgent } = src('core/ua');
const { NEWTAB } = src('core/pages');

const NAME_CHARS = 'abcXYZ019 ._-()<>:"/\\|?*\u0000\u001fабвёЁ😀\t';

test('закон: имя загрузки безопасно - внутри папки, без запретных знаков и имён устройств, не длиннее предела', () => {
  forAll('download-name', (r) => r.pick([r.str(NAME_CHARS, 0, 40), r.pick(['CON', 'CON.tar.gz', 'aux.a.b.c', 'nul.txt', 'com1.zip', 'LPT9', '..', '.', '../../etc/passwd', 'a'.repeat(300) + '.zip', 'x.' + 'e'.repeat(30), '😀'.repeat(200) + '.txt']), null]), (raw) => {
    const n = dl.safeName(raw);
    assert.ok(n.length > 0);
    assert.doesNotMatch(n, /[\\/<>:"|?*\u0000-\u001f]/);
    assert.doesNotMatch(n, /^[\s.]|[\s.]$/);
    assert.doesNotMatch(n.split('.')[0], /^(con|prn|aux|nul|com\d|lpt\d)$/i);
    assert.ok([...n].length <= dl.MAX_NAME, `${[...n].length}`);
    assert.equal(dl.safeName(n), n, 'приведение идемпотентно');
    const dir = path.join(path.sep, 'home', 'u', 'Загрузки');
    assert.equal(path.dirname(dl.targetPath(dir, raw, () => false)), dir);
  }, 1500);
});

test('закон: загрузка никогда не перезаписывает существующий файл', () => {
  forAll('download-unique', (r) => ({ want: r.pick(['a.zip', 'a', 'отчёт.pdf', 'a (1).zip', '.bashrc']), taken: Array.from({ length: r.int(0, 30) }, () => r.pick(['a.zip', 'a (1).zip', 'a (2).zip', 'a', 'a (1)', 'отчёт.pdf', 'отчёт (1).pdf', 'bashrc', 'bashrc (1)'])) }), ({ want, taken }) => {
    const set = new Set(taken);
    const name = dl.uniqueName(want, (n) => set.has(n));
    assert.ok(!set.has(name));
    if (!set.has(dl.safeName(want))) assert.equal(name, dl.safeName(want));
  });
  assert.match(dl.uniqueName('a.zip', () => true), /^a \(\d{6,}\)\.zip$/);
});

test('доля и размер загрузки', () => {
  assert.equal(dl.progress(5, 0), null);
  assert.equal(dl.progress(5, 10), 0.5);
  assert.equal(dl.progress(50, 10), 1);
  assert.equal(dl.formatBytes(0), '0 Б');
  assert.equal(dl.formatBytes(1536), '1,5 КБ');
  assert.equal(dl.formatBytes(1536, 'en'), '1.5 KB');
  assert.equal(dl.formatBytes(50 * 1024 * 1024, 'en'), '50 MB');
  assert.equal(dl.formatBytes(-1), '0 Б');
  assert.equal(dl.formatBytes(2 ** 60, 'en'), '1048576 TB');
});

test('закон: у полосы вкладок всегда есть активная вкладка из списка, id не повторяются, закрытая возвращается на место', () => {
  forAll('tabs-model', (r) => Array.from({ length: r.int(1, 60) }, () => ({ op: r.pick(['open', 'open', 'close', 'close', 'reopen', 'activate', 'move', 'cycle', 'num', 'bg']), a: r.int(0, 1e6), b: r.int(-2, 12) })), (ops) => {
    const t = createTabs();
    t.open('https://start/');
    const seen = new Set(t.ids());
    for (const o of ops) {
      const ids = t.ids();
      const pick = ids[o.a % ids.length];
      if (o.op === 'open') t.open(`https://x/${o.a}`);
      else if (o.op === 'bg') { const before = t.active(); t.open(`https://bg/${o.a}`, { activate: false }); assert.equal(t.active(), before); }
      else if (o.op === 'close') {
        const at = ids.indexOf(pick);
        const url = t.get(pick).url;
        const wasActive = t.active() === pick;
        const res = t.close(pick);
        if (ids.length === 1) assert.equal(t.get(res.opened).url, NEWTAB);
        else if (wasActive) assert.equal(t.active(), t.ids()[Math.min(at, t.ids().length - 1)]);
        if (o.b > 8) {
          const back = t.reopen();
          assert.equal(t.get(back).url, url);
          assert.equal(t.ids().indexOf(back), Math.min(at, t.ids().length - 1));
          assert.equal(t.active(), back);
        }
      } else if (o.op === 'reopen') t.reopen();
      else if (o.op === 'activate') assert.equal(t.activate(pick), true);
      else if (o.op === 'move') { assert.equal(t.move(pick, o.b), true); assert.equal(t.ids().indexOf(pick), Math.max(0, Math.min(ids.length - 1, o.b))); }
      else if (o.op === 'cycle') { const i = ids.indexOf(t.active()); t.cycle(o.b >= 0 ? 1 : -1); assert.equal(t.active(), ids[((i + (o.b >= 0 ? 1 : -1)) % ids.length + ids.length) % ids.length]); }
      else t.byNumber(Math.max(1, o.b));
      const now = t.ids();
      assert.ok(now.length >= 1);
      assert.ok(now.includes(t.active()));
      assert.equal(new Set(now).size, now.length);
      for (const id of now) seen.add(id);
      assert.ok(t.closedCount() <= MAX_CLOSED);
    }
    assert.equal(Math.max(...seen), seen.size, 'новые id идут подряд и не повторяются');
  }, 300);
});

test('вкладки: крайние случаи', () => {
  const t = createTabs();
  assert.equal(t.cycle(1), null);
  assert.equal(t.byNumber(1), null);
  assert.equal(t.reopen(), null);
  const a = t.open();
  assert.equal(t.get(a).url, NEWTAB);
  const b = t.open('https://b/', { after: 999 });
  assert.deepEqual(t.ids(), [a, b]);
  assert.equal(t.byNumber(9), b);
  assert.equal(t.byNumber(1), a);
  assert.equal(t.byNumber(5), null);
  assert.equal(t.close(12345), null);
  assert.equal(t.activate(12345), false);
  assert.equal(t.move(12345, 0), false);
  assert.equal(t.update(a, { url: 'https://a/', title: 'A' }), true);
  assert.equal(t.update(a, {}), true);
  assert.equal(t.update(999, {}), false);
  assert.deepEqual(t.list()[0], { id: a, url: 'https://a/', title: 'A' });
  assert.equal(t.get(999), null);
  for (let i = 0; i < 30; i++) t.close(t.open());
  assert.equal(t.closedCount(), MAX_CLOSED);
});

const RU = { KeyT: 'е', KeyW: 'ц', KeyL: 'д', KeyR: 'к', KeyD: 'в', KeyH: 'р', KeyJ: 'о', KeyF: 'а', KeyN: 'т', KeyI: 'ш', KeyB: 'и', KeyP: 'з', KeyU: 'г' };
const CODES = [...Object.keys(RU), 'Tab', 'PageDown', 'PageUp', 'F4', 'F5', 'F6', 'F11', 'F12', 'Equal', 'Minus', 'Digit0', 'Digit1', 'Digit5', 'Digit9', 'ArrowLeft', 'ArrowRight', 'Home', 'Comma', 'Delete', 'KeyA', 'KeyZ', 'Space', 'Enter', 'NumpadAdd', 'Numpad0', 'NumpadSubtract', 'BrowserBack'];

test('закон: горячие клавиши одинаковы в русской и английской раскладке', () => {
  forAll('keys-layout', (r) => ({ code: r.pick(Object.keys(RU)), control: r.bool(0.7), shift: r.bool(0.3), alt: r.bool(0.2), meta: r.bool(0.1) }), (k) => {
    const en = actionFor({ type: 'keyDown', key: k.code.slice(3).toLowerCase(), ...k });
    const ru = actionFor({ type: 'keyDown', key: RU[k.code], ...k });
    assert.equal(ru, en);
  });
});

test('закон: набор текста (буквы без Ctrl и Alt) и отпускание клавиш ничего не делают', () => {
  forAll('keys-typing', (r) => ({ type: r.pick(['keyDown', 'keyUp', 'char']), code: r.pick(CODES), key: 'x', control: false, alt: false, shift: r.bool(), meta: false }), (k) => {
    const a = actionFor(k);
    if (k.type !== 'keyDown') assert.equal(a, null);
    else if (/^(Key|Digit|Space|Enter|Equal|Minus|Comma|Tab|Arrow|Home|Page|Delete|Numpad)/.test(k.code)) assert.equal(a, null);
  });
});

test('горячие клавиши: примеры', () => {
  const k = (code, mods = {}) => actionFor({ type: 'keyDown', code, key: '', ...mods });
  assert.equal(k('KeyT', { control: true }), 'newTab');
  assert.equal(k('KeyT', { control: true, shift: true }), 'reopenTab');
  assert.equal(k('KeyT', { meta: true }), null);
  assert.equal(actionFor({ type: 'keyDown', code: 'KeyT', meta: true }, true), 'newTab');
  assert.equal(k('Tab', { control: true }), 'nextTab');
  assert.equal(k('Tab', { control: true, shift: true }), 'prevTab');
  assert.equal(k('PageDown', { control: true }), 'nextTab');
  assert.equal(k('PageUp', { control: true }), 'prevTab');
  assert.equal(k('PageUp', { control: true, shift: true }), null);
  assert.equal(k('Digit3', { control: true }), 'tab:3');
  assert.equal(k('Digit3', { control: true, shift: true }), null);
  assert.equal(k('Equal', { control: true, shift: true }), 'zoomIn');
  assert.equal(k('F5', { control: true }), 'hardReload');
  assert.equal(k('F5'), 'reload');
  assert.equal(k('F5', { shift: true }), null);
  assert.equal(k('ArrowLeft', { alt: true }), 'back');
  assert.equal(k('ArrowRight', { alt: true }), 'forward');
  assert.equal(k('KeyD', { alt: true }), 'focusAddress');
  assert.equal(k('Home', { alt: true }), 'home');
  assert.equal(k('KeyQ', { alt: true }), null);
  assert.equal(k('KeyQ', { alt: true, control: true }), null);
  assert.equal(actionFor({ type: 'keyDown', key: 'Escape', code: 'Escape' }), 'escape');
  assert.equal(actionFor(null), null);
  assert.equal(actionFor({ type: 'keyDown' }), null);
});

test('закон: строка браузера без Electron и имени приложения, Chrome на месте, приведение идемпотентно', () => {
  forAll('ua', (r) => {
    const parts = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'AppleWebKit/537.36 (KHTML, like Gecko)', `Chrome/${r.int(100, 160)}.0.${r.int(0, 9999)}.${r.int(0, 300)}`, 'Safari/537.36'];
    const extra = [`Electron/${r.int(30, 50)}.${r.int(0, 9)}.${r.int(0, 9)}`, `internet-browser/0.${r.int(0, 9)}.0`, `InternetBrowser/1.0.${r.int(0, 9)}`];
    for (const e of extra) if (r.bool(0.7)) parts.splice(r.int(1, parts.length), 0, e);
    return parts.join(' ');
  }, (ua) => {
    const c = cleanUserAgent(ua);
    assert.doesNotMatch(c, /Electron|internet-?browser/i);
    assert.match(c, /Chrome\/\d+/);
    assert.match(c, /^Mozilla\/5\.0 /);
    assert.equal(cleanUserAgent(c), c);
  });
  assert.equal(cleanUserAgent(undefined), '');
});
