// Темы оформления - те же пять, что в Paint Pro и калькуляторах Хаба, с теми же именами.
// Цвета живут в src/ui/themes.css; здесь только список и проверка значения.
'use strict';

const THEMES = [
  { id: 'glass', dark: true, ru: 'Стеклянная', en: 'Glass' },
  { id: 'formal', dark: true, ru: 'Строгая', en: 'Formal' },
  { id: 'light', dark: false, ru: 'Светлая', en: 'Light' },
  { id: 'night', dark: true, ru: 'Ночная', en: 'Night' },
  { id: 'warm', dark: true, ru: 'Тёплая', en: 'Warm' },
];
const DEFAULT_THEME = 'glass';

function normalizeTheme(id) {
  return THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
}

function isDark(id) {
  return THEMES.find((t) => t.id === normalizeTheme(id)).dark;
}

module.exports = { THEMES, DEFAULT_THEME, normalizeTheme, isDark };
