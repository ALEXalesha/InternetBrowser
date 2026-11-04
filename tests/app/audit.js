// Проверка читаемости и наложений, выполняется внутри страницы (page.evaluate(audit, opts)).
// Контраст считается по WCAG: цвет текста против фона под ним (слои фона складываются до
// --app-base темы; градиентные пятна фона не учитываются). Нужно >= 4.5, крупному тексту >= 3.
// Отключённые элементы (disabled, полупрозрачные) по WCAG не проверяются.
'use strict';

function audit(opts) {
  const o = opts || {};
  const problems = [];
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--app-base').trim() || '#000';
  document.body.appendChild(probe);
  const base = parse(getComputedStyle(probe).color);
  probe.remove();
  const hidden = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.99) return true;
      if (e.disabled || e.getAttribute('aria-disabled') === 'true') return true;
    }
    return false;
  };
  // Фон под текстом: слои цвета до --app-base. Градиент у самого элемента или предка (кроме
  // фона страницы html/body) - несколько кандидатов, берётся худший.
  const background = (el) => {
    const layers = [];
    let grad = null;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (!grad && e !== document.documentElement && e !== document.body && /gradient/.test(cs.backgroundImage)) {
        grad = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
        if (grad.length) break;
        grad = null;
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) layers.push(c);
    }
    const stack = (under) => { let bg = under; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); return bg; };
    return grad ? grad.map((g) => stack(over(g, base))) : [stack(base)];
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} «${(el.textContent || el.value || '').trim().slice(0, 30)}»`;

  // 1. контраст текста
  const els = [...document.querySelectorAll(o.scope || 'body *')].filter((el) => {
    if (['SCRIPT', 'STYLE', 'SVG', 'svg', 'path', 'OPTION'].includes(el.tagName)) return false;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return own || (el.tagName === 'INPUT' && /^(text|search|url|)$/.test(el.type) && el.value);
  });
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || hidden(el)) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const c = Math.min(...background(el).map((bg) => ratio(over(fg, bg), bg)));
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (c < need) problems.push(`контраст ${c.toFixed(2)} < ${need}: ${label(el)}`);
  }

  // 2. наложения в группах (кнопки полосы, плитки, строки настроек)
  for (const sel of o.groups || []) {
    for (const group of document.querySelectorAll(sel)) {
      const kids = [...group.children].filter((k) => !hidden(k)).map((k) => ({ k, r: k.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].r;
          const b = kids[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 1 && h > 1) problems.push(`наложение: ${label(kids[i].k)} и ${label(kids[j].k)}`);
        }
      }
    }
  }

  // 3. ничего не вылезает за окно и текст не обрезан без многоточия
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push(`горизонтальная прокрутка: ${document.documentElement.scrollWidth} > ${innerWidth}`);
  for (const el of document.querySelectorAll(o.fit || 'button, a, h1, h2, h3, label, .row, .li, .setrow')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || hidden(el)) continue;
    if (r.right > innerWidth + 1 && (!o.clipX || !el.closest(o.clipX))) problems.push(`за правым краем окна: ${label(el)} (${Math.round(r.right)} > ${innerWidth})`);
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX === 'visible' && el.children.length === 0) problems.push(`текст не помещается: ${label(el)}`);
  }
  return problems;
}

module.exports = { audit };
