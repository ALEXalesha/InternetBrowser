// Помощник законов: случайные входы с зерном. Зерно по умолчанию постоянное, другое - IB_SEED=123.
// Упавший закон печатает зерно и номер случая, чтобы повторить ровно его.
'use strict';
const path = require('path');

const ROOT = process.env.IB_ROOT || path.join(__dirname, '..', '..');
const SEED = Number(process.env.IB_SEED || 20261103) >>> 0;
const RUNS = Number(process.env.IB_RUNS || 300);

function src(rel) {
  return require(path.join(ROOT, 'src', rel));
}

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
    str: (alphabet, lo, hi) => {
      const n = r.int(lo, hi);
      let s = '';
      for (let i = 0; i < n; i++) s += alphabet[Math.floor(next() * alphabet.length)];
      return s;
    },
  };
  return r;
}

function forAll(name, gen, prop, runs = RUNS) {
  const base = (SEED ^ hash(name)) >>> 0;
  for (let i = 0; i < runs; i++) {
    const r = rng((base + i * 0x9e3779b1) >>> 0);
    const input = gen(r, i);
    try {
      prop(input, r);
    } catch (e) {
      e.message = `${name}: случай ${i}, зерно IB_SEED=${SEED}\nвход: ${safe(input)}\n${e.message}`;
      throw e;
    }
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function safe(v) {
  try { return JSON.stringify(v).slice(0, 2000); } catch { return String(v); }
}

module.exports = { ROOT, SEED, RUNS, src, rng, forAll };
