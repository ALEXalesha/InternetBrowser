// Горячие клавиши браузера. Сначала смотрится физическая клавиша (code), поэтому Ctrl+T
// работает и в русской раскладке, где та же клавиша печатает «е».
'use strict';

const CTRL = {
  KeyT: 'newTab', KeyW: 'closeTab', KeyL: 'focusAddress', KeyR: 'reload', KeyD: 'bookmark', KeyH: 'history',
  KeyJ: 'downloads', KeyF: 'find', KeyN: 'newTab', Equal: 'zoomIn', NumpadAdd: 'zoomIn', Minus: 'zoomOut',
  NumpadSubtract: 'zoomOut', Digit0: 'zoomReset', Numpad0: 'zoomReset', F4: 'closeTab', Comma: 'settings',
  KeyP: 'print', KeyU: 'viewSource',
};
const CTRL_SHIFT = { KeyT: 'reopenTab', KeyR: 'hardReload', KeyI: 'devtools', Tab: 'prevTab', KeyB: 'toggleBookmarksBar', Delete: 'clearData' };
const PLAIN = { F5: 'reload', F6: 'focusAddress', F11: 'fullscreen', F12: 'devtools', BrowserBack: 'back', BrowserForward: 'forward', BrowserRefresh: 'reload' };

/**
 * Действие по нажатию (input из before-input-event: type, key, code, control, meta, shift, alt)
 * или null. mac - Cmd вместо Ctrl.
 */
function actionFor(input, mac = false) {
  if (!input || input.type !== 'keyDown') return null;
  const code = input.code || '';
  const ctrl = mac ? !!input.meta : !!input.control;
  const { shift, alt } = input;
  if (input.key === 'Escape' && !ctrl && !alt) return 'escape';
  if (alt && !ctrl && !shift) {
    if (code === 'ArrowLeft') return 'back';
    if (code === 'ArrowRight') return 'forward';
    if (code === 'KeyD') return 'focusAddress';
    if (code === 'Home') return 'home';
    return null;
  }
  if (ctrl && !alt) {
    if (code === 'Tab') return shift ? 'prevTab' : 'nextTab';
    if (code === 'PageDown' && !shift) return 'nextTab';
    if (code === 'PageUp' && !shift) return 'prevTab';
    if (code === 'F5') return 'hardReload';
    const digit = /^Digit([1-9])$/.exec(code);
    if (digit && !shift) return `tab:${digit[1]}`;
    if (shift) return CTRL_SHIFT[code] || (code === 'Equal' ? 'zoomIn' : null);
    return CTRL[code] || null;
  }
  if (!ctrl && !alt && !shift) return PLAIN[code] || null;
  return null;
}

module.exports = { actionFor };
